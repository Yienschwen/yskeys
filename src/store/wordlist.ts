import { WORDLIST_KEY } from '../config';
import { errorMessage } from './persistence';
import type { StorageLike } from './persistence';
import { isFiniteNumber, isRecord } from './schema';

/**
 * The imported word list lives under its own key, deliberately outside the history
 * store: the history budget guard must never prune it, and "clear all data" must not
 * throw away a file the user had to download.
 */

export interface StoredWordList {
  /** The file name, shown in the UI so the source stays obvious. */
  readonly name: string;
  readonly importedAt: number;
  readonly words: readonly string[];
}

export interface WordListSaveResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function loadWordList(storage: StorageLike): StoredWordList | null {
  try {
    const raw = storage.getItem(WORDLIST_KEY);
    if (raw === null || raw === '') {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const name = parsed['name'];
    const importedAt = parsed['importedAt'];
    const words = parsed['words'];
    if (typeof name !== 'string' || !isFiniteNumber(importedAt) || !isWordArray(words)) {
      return null;
    }
    return words.length === 0 ? null : { name, importedAt, words };
  } catch {
    return null;
  }
}

export function saveWordList(storage: StorageLike, list: StoredWordList): WordListSaveResult {
  try {
    storage.setItem(WORDLIST_KEY, JSON.stringify(list));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
}

export function removeWordList(storage: StorageLike): void {
  try {
    storage.removeItem(WORDLIST_KEY);
  } catch {
    // Best effort: the next load would simply find it again.
  }
}

function isWordArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
