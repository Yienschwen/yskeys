import { describe, expect, it } from 'vitest';
import { WORDLIST_KEY } from '../config';
import { clearStore, saveStore } from '../store/persistence';
import { defaultStore } from '../store/schema';
import type { StorageLike } from '../store/persistence';
import { loadWordList, removeWordList, saveWordList } from '../store/wordlist';
import { MemoryStorage, UNREADABLE_STORAGE } from './helpers';

const SAMPLE = { name: 'eff_short_wordlist_1.txt', importedAt: 1000, words: ['acid', 'acorn'] };

describe('word list storage', () => {
  it('round-trips under its own key', () => {
    const storage = new MemoryStorage();
    expect(saveWordList(storage, SAMPLE)).toEqual({ ok: true });
    expect(loadWordList(storage)).toEqual(SAMPLE);
    expect(storage.getItem(WORDLIST_KEY)).not.toBeNull();
  });

  it('returns null when nothing was imported', () => {
    expect(loadWordList(new MemoryStorage())).toBeNull();
  });

  it('returns null rather than throwing on unreadable or malformed data', () => {
    const broken = new MemoryStorage();
    broken.setItem(WORDLIST_KEY, '{ not json');
    expect(loadWordList(broken)).toBeNull();

    const wrongShape = new MemoryStorage();
    wrongShape.setItem(WORDLIST_KEY, JSON.stringify({ name: 'x', importedAt: 'soon', words: [] }));
    expect(loadWordList(wrongShape)).toBeNull();

    const empty = new MemoryStorage();
    empty.setItem(WORDLIST_KEY, JSON.stringify({ name: 'x', importedAt: 1, words: [] }));
    expect(loadWordList(empty)).toBeNull();
  });

  it('survives storage that refuses to cooperate', () => {
    expect(loadWordList(UNREADABLE_STORAGE)).toBeNull();
    expect(removeWordList.length).toBe(1);
    expect(() => {
      removeWordList(UNREADABLE_STORAGE);
    }).not.toThrow();
    expect(saveWordList(UNREADABLE_STORAGE, SAMPLE).ok).toBe(false);
  });

  it('removes the list', () => {
    const storage = new MemoryStorage();
    saveWordList(storage, SAMPLE);
    removeWordList(storage);
    expect(loadWordList(storage)).toBeNull();
  });

  it('is NOT touched by "clear all data"', () => {
    const storage = new MemoryStorage();
    saveWordList(storage, SAMPLE);
    saveStore(storage, defaultStore(1));

    const removed = clearStore(storage);

    // Only the history key was there to remove.
    expect(removed).toBe(1);
    expect(loadWordList(storage)).toEqual(SAMPLE);
  });

  it('rejects a storage whose writes fail, with a reason', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    };
    const result = saveWordList(storage, SAMPLE);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/QuotaExceededError/);
  });
});
