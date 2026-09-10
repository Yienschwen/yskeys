import { BACKUP_KEY_PREFIX, CORRUPT_KEY_PREFIX, MAX_PAYLOAD_CHARS, STORAGE_KEY } from '../config';
import type { Metric } from '../core/metrics';
import { migrateStore } from './migrations';
import { defaultStore, isRecord } from './schema';
import type { Store } from './schema';

/**
 * localStorage IO. The storage object is injected rather than reached for globally,
 * so every failure path (missing, unreadable, full) is testable.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export type LoadStatus = 'empty' | 'ok' | 'corrupt' | 'unavailable';

export interface LoadResult {
  store: Store;
  status: LoadStatus;
  reason?: string;
  /** Where an unreadable payload was parked, when one was found. */
  corruptKey?: string;
}

export interface SaveResult {
  ok: boolean;
  /** How many trigram/bigram units had to be dropped to fit the budget. */
  pruned: number;
  reason?: string;
}

export function loadStore(storage: StorageLike, now: number): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return { store: defaultStore(now), status: 'unavailable', reason: errorMessage(error) };
  }
  if (raw === null || raw === '') {
    return { store: defaultStore(now), status: 'empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const corruptKey = park(storage, raw, now);
    return {
      store: defaultStore(now),
      status: 'corrupt',
      reason: `stored history is not valid JSON (${errorMessage(error)})`,
      ...(corruptKey === null ? {} : { corruptKey }),
    };
  }

  const migrated = migrateStore(parsed);
  if (!migrated.ok) {
    const corruptKey = park(storage, raw, now);
    return {
      store: defaultStore(now),
      status: 'corrupt',
      reason: migrated.reason,
      ...(corruptKey === null ? {} : { corruptKey }),
    };
  }
  return { store: migrated.store, status: 'ok' };
}

export function saveStore(storage: StorageLike, store: Store): SaveResult {
  let candidate = store;
  let pruned = 0;
  let text = JSON.stringify(candidate);

  if (text.length > MAX_PAYLOAD_CHARS) {
    const budgeted = enforceBudget(text, candidate);
    candidate = budgeted.store;
    pruned = budgeted.dropped;
    text = JSON.stringify(candidate);
  }

  try {
    storage.setItem(STORAGE_KEY, text);
  } catch (error) {
    // The previous value is untouched: setItem is atomic per key, so a failed write
    // leaves the last good history in place.
    return { ok: false, pruned, reason: errorMessage(error) };
  }
  return { ok: true, pruned };
}

/**
 * Drops the weakest units until the payload fits. Trigrams go first, and each pass
 * removes the lowest-attempt half rather than one unit at a time, because re-measuring
 * a multi-megabyte string per unit would be slow enough to notice.
 */
export function enforceBudget(text: string, store: Store): { store: Store; dropped: number } {
  let current = store;
  let dropped = 0;
  let size = text.length;

  for (const dimension of ['trigrams', 'bigrams'] as const) {
    while (size > MAX_PAYLOAD_CHARS) {
      const map = current.aggregates[dimension];
      const units = Object.keys(map).length;
      if (units === 0) {
        break;
      }
      const sorted = Object.entries(map).sort((a, b) => a[1].attempts - b[1].attempts);
      const dropCount = Math.max(1, Math.ceil(sorted.length / 2));
      const kept: Record<string, Metric> = {};
      for (const [unit, metric] of sorted.slice(dropCount)) {
        kept[unit] = metric;
      }
      dropped += dropCount;
      current = {
        ...current,
        aggregates: { ...current.aggregates, [dimension]: kept },
      };
      size = JSON.stringify(current).length;
    }
    if (size <= MAX_PAYLOAD_CHARS) {
      break;
    }
  }

  return { store: current, dropped };
}

/** Keeps exactly one undo step: the previous store, written before a replace import. */
export function backupStore(storage: StorageLike, store: Store, now: number): string | null {
  const key = `${BACKUP_KEY_PREFIX}${String(now)}`;
  try {
    for (const existing of listKeysWithPrefix(storage, BACKUP_KEY_PREFIX)) {
      storage.removeItem(existing);
    }
    storage.setItem(key, JSON.stringify(store));
    return key;
  } catch {
    return null;
  }
}

export function restoreBackup(storage: StorageLike, key: string): Store | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return null;
    }
    const migrated = migrateStore(JSON.parse(raw));
    return migrated.ok ? migrated.store : null;
  } catch {
    return null;
  }
}

export function listBackupKeys(storage: StorageLike): string[] {
  return listKeysWithPrefix(storage, BACKUP_KEY_PREFIX);
}

export function clearStore(storage: StorageLike): number {
  let removed = 0;
  const keys = [
    STORAGE_KEY,
    ...listKeysWithPrefix(storage, BACKUP_KEY_PREFIX),
    ...listKeysWithPrefix(storage, CORRUPT_KEY_PREFIX),
  ];
  for (const key of keys) {
    try {
      if (storage.getItem(key) !== null) {
        storage.removeItem(key);
        removed += 1;
      }
    } catch {
      // Clearing is best effort; a key that refuses to go is simply not counted.
    }
  }
  return removed;
}

export function storageAvailable(storage: StorageLike): boolean {
  const probe = 'yskeys:probe';
  try {
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function listKeysWithPrefix(storage: StorageLike, prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
  } catch {
    return keys;
  }
  return keys;
}

/** Parks an unreadable payload under its own prefix so a later save cannot erase it. */
function park(storage: StorageLike, raw: string, now: number): string | null {
  const key = `${CORRUPT_KEY_PREFIX}${String(now)}`;
  try {
    storage.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  if (isRecord(error) && typeof error['name'] === 'string' && typeof error['message'] === 'string') {
    return `${error['name']}: ${error['message']}`;
  }
  return error instanceof Error ? error.message : String(error);
}
