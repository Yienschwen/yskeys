import { MAX_TEXTSOURCE_CHARS, TEXTSOURCE_KEY } from '../config';
import type { SourceStats } from '../core/sourcetext';
import { errorMessage } from './persistence';
import type { StorageLike } from './persistence';
import { isFiniteNumber, isRecord } from './schema';

/**
 * The imported text / code source lives under its own key, for exactly the same reason
 * the word list does: it is material the user had to go and fetch, so the history
 * budget guard must never prune it and "clear all data" must not delete it.
 */

export interface StoredTextSource {
  /** A file name, an archive name, or "Pasted text". */
  readonly name: string;
  readonly importedAt: number;
  /** Normalised text. Kept for reloads; the extractor runs again on load. */
  readonly text: string;
  readonly stats: SourceStats;
}

export interface TextSourceSaveResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function loadTextSource(storage: StorageLike): StoredTextSource | null {
  try {
    const raw = storage.getItem(TEXTSOURCE_KEY);
    if (raw === null || raw === '') {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const name = parsed['name'];
    const importedAt = parsed['importedAt'];
    const text = parsed['text'];
    if (typeof name !== 'string' || !isFiniteNumber(importedAt) || typeof text !== 'string') {
      return null;
    }
    if (text.length === 0) {
      return null;
    }
    return { name, importedAt, text, stats: normaliseStats(parsed['stats'], text) };
  } catch {
    return null;
  }
}

export function saveTextSource(
  storage: StorageLike,
  source: StoredTextSource,
): TextSourceSaveResult {
  if (source.text.length > MAX_TEXTSOURCE_CHARS) {
    return {
      ok: false,
      reason: `the practice text is larger than ${String(MAX_TEXTSOURCE_CHARS)} characters`,
    };
  }
  try {
    storage.setItem(TEXTSOURCE_KEY, JSON.stringify(source));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

export function removeTextSource(storage: StorageLike): void {
  try {
    storage.removeItem(TEXTSOURCE_KEY);
  } catch {
    // Best effort: the next load would simply find it again.
  }
}

/** Stats are informational, so a missing or malformed block degrades instead of failing. */
function normaliseStats(value: unknown, text: string): SourceStats {
  const lines = text.split('\n').length;
  if (!isRecord(value)) {
    return { bytes: text.length, files: 0, skipped: 0, lines };
  }
  const number = (key: string): number => (isFiniteNumber(value[key]) ? value[key] : 0);
  return {
    bytes: number('bytes'),
    files: number('files'),
    skipped: number('skipped'),
    lines: number('lines') || lines,
  };
}
