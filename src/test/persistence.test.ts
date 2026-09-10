import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEY_PREFIX,
  CORRUPT_KEY_PREFIX,
  MAX_PAYLOAD_CHARS,
  STORAGE_KEY,
} from '../config';
import type { Metric } from '../core/metrics';
import {
  backupStore,
  clearStore,
  enforceBudget,
  listBackupKeys,
  loadStore,
  restoreBackup,
  saveStore,
  storageAvailable,
} from '../store/persistence';
import type { StorageLike } from '../store/persistence';
import { defaultStore } from '../store/schema';
import type { Store } from '../store/schema';

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
}

const UNREADABLE: StorageLike = {
  getItem() {
    throw new Error('SecurityError: storage is disabled');
  },
  setItem() {
    throw new Error('SecurityError: storage is disabled');
  },
  removeItem() {
    throw new Error('SecurityError: storage is disabled');
  },
  key() {
    return null;
  },
  length: 0,
};

const FULL: StorageLike = {
  getItem() {
    return null;
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    // nothing stored
  },
  key() {
    return null;
  },
  length: 0,
};

function unitName(index: number): string {
  return index.toString(36).padStart(4, '0');
}

/**
 * A store large enough to trip the budget guard. 45k entries of ~57 characters is
 * comfortably past the 2 M limit, and halving it lands well under, so the pruning
 * loop terminates in one pass.
 */
function bigStore(dimension: 'trigrams' | 'bigrams', units: number): Store {
  const map: Record<string, Metric> = {};
  for (let index = 0; index < units; index += 1) {
    map[unitName(index)] = { attempts: index + 1, firstTryCorrect: index, wrongTyped: {} };
  }
  const store = defaultStore(0);
  return {
    ...store,
    aggregates: { ...store.aggregates, [dimension]: map },
  };
}

describe('loadStore', () => {
  it('reports an empty store when nothing was ever saved', () => {
    const result = loadStore(new MemoryStorage(), 500);
    expect(result.status).toBe('empty');
    expect(result.store.sessions).toEqual([]);
    expect(result.store.aggregates.createdAt).toBe(500);
  });

  it('round-trips a saved store', () => {
    const storage = new MemoryStorage();
    const store = defaultStore(100);
    expect(saveStore(storage, store)).toEqual({ ok: true, pruned: 0 });
    const result = loadStore(storage, 999);
    expect(result.status).toBe('ok');
    expect(result.store).toEqual(store);
  });

  it('parks unreadable JSON instead of overwriting it', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{ not json');
    const result = loadStore(storage, 42);
    expect(result.status).toBe('corrupt');
    expect(result.reason).toMatch(/not valid JSON/);
    expect(result.corruptKey).toBe(`${CORRUPT_KEY_PREFIX}42`);
    expect(storage.getItem(`${CORRUPT_KEY_PREFIX}42`)).toBe('{ not json');
    expect(storage.getItem(STORAGE_KEY)).toBe('{ not json');
  });

  it('treats a future schema version as corrupt, and keeps the payload', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultStore(1), schemaVersion: 99 }));
    const result = loadStore(storage, 42);
    expect(result.status).toBe('corrupt');
    expect(result.reason).toMatch(/newer version/);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('reports unavailable storage rather than throwing', () => {
    const result = loadStore(UNREADABLE, 1);
    expect(result.status).toBe('unavailable');
    expect(result.reason).toMatch(/SecurityError/);
    expect(result.store.sessions).toEqual([]);
  });
});

describe('saveStore', () => {
  it('reports a failed write without throwing, leaving the old value alone', () => {
    const result = saveStore(FULL, defaultStore(1));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/QuotaExceededError/);
    expect(result.pruned).toBe(0);
  });

  it('prunes before writing when the payload is over budget', () => {
    const storage = new MemoryStorage();
    const result = saveStore(storage, bigStore('trigrams', 45_000));
    expect(result.ok).toBe(true);
    expect(result.pruned).toBeGreaterThan(0);
    expect(storage.getItem(STORAGE_KEY)?.length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
  });
});

describe('enforceBudget', () => {
  it('drops the weakest trigrams first and keeps the strongest', () => {
    const store = bigStore('trigrams', 45_000);
    const text = JSON.stringify(store);
    expect(text.length).toBeGreaterThan(MAX_PAYLOAD_CHARS);

    const result = enforceBudget(text, store);
    expect(result.dropped).toBeGreaterThan(0);
    expect(JSON.stringify(result.store).length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);

    const kept = result.store.aggregates.trigrams;
    expect(kept[unitName(0)]).toBeUndefined();
    expect(kept[unitName(44_999)]).toBeDefined();
    expect(kept[unitName(44_999)]?.attempts).toBe(45_000);
    // Bigrams were not touched, because pruning trigrams was enough.
    expect(Object.keys(result.store.aggregates.bigrams)).toHaveLength(0);
  });

  it('prunes bigrams once there are no trigrams left to prune', () => {
    const store = bigStore('bigrams', 45_000);
    const result = enforceBudget(JSON.stringify(store), store);

    expect(result.dropped).toBeGreaterThan(0);
    expect(Object.keys(result.store.aggregates.trigrams)).toHaveLength(0);
    expect(Object.keys(result.store.aggregates.bigrams).length).toBeLessThan(45_000);
    expect(JSON.stringify(result.store).length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
  });

  it('leaves a store that is already within budget alone', () => {
    const store = defaultStore(1);
    const result = enforceBudget(JSON.stringify(store), store);
    expect(result.dropped).toBe(0);
    expect(result.store).toBe(store);
  });
});

describe('backups', () => {
  it('keeps exactly one undo step', () => {
    const storage = new MemoryStorage();
    const first = backupStore(storage, defaultStore(1), 10);
    const second = backupStore(storage, defaultStore(2), 20);

    expect(first).toBe(`${BACKUP_KEY_PREFIX}10`);
    expect(listBackupKeys(storage)).toEqual([`${BACKUP_KEY_PREFIX}20`]);
    expect(restoreBackup(storage, second ?? '')?.aggregates.createdAt).toBe(2);
    expect(restoreBackup(storage, first ?? '')).toBeNull();
  });

  it('returns null instead of throwing when a backup cannot be read', () => {
    expect(restoreBackup(new MemoryStorage(), `${BACKUP_KEY_PREFIX}1`)).toBeNull();
    expect(restoreBackup(UNREADABLE, `${BACKUP_KEY_PREFIX}1`)).toBeNull();
    expect(backupStore(UNREADABLE, defaultStore(1), 1)).toBeNull();
  });

  it('refuses to restore a backup that no longer validates', () => {
    const storage = new MemoryStorage();
    storage.setItem(`${BACKUP_KEY_PREFIX}7`, '{"schemaVersion":99}');
    expect(restoreBackup(storage, `${BACKUP_KEY_PREFIX}7`)).toBeNull();
  });
});

describe('clearStore', () => {
  it('removes the store, the backup and any parked payload', () => {
    const storage = new MemoryStorage();
    saveStore(storage, defaultStore(1));
    backupStore(storage, defaultStore(1), 5);
    storage.setItem(`${CORRUPT_KEY_PREFIX}9`, 'junk');

    expect(clearStore(storage)).toBe(3);
    expect(storage.length).toBe(0);
    expect(loadStore(storage, 100).status).toBe('empty');
  });

  it('counts nothing when there is nothing to clear', () => {
    expect(clearStore(new MemoryStorage())).toBe(0);
    expect(clearStore(UNREADABLE)).toBe(0);
  });
});

describe('storageAvailable', () => {
  it('detects working and broken storage', () => {
    expect(storageAvailable(new MemoryStorage())).toBe(true);
    expect(storageAvailable(UNREADABLE)).toBe(false);
  });

  it('does not leave its probe key behind', () => {
    const storage = new MemoryStorage();
    storageAvailable(storage);
    expect(storage.length).toBe(0);
  });
});
