import { describe, expect, it } from 'vitest';
import { MAX_TEXTSOURCE_CHARS, TEXTSOURCE_KEY } from '../config';
import { loadTextSource, removeTextSource, saveTextSource } from '../store/textsource';
import type { StoredTextSource } from '../store/textsource';
import { MemoryStorage, UNREADABLE_STORAGE } from './helpers';

function source(overrides: Partial<StoredTextSource> = {}): StoredTextSource {
  return {
    name: 'repo.zip',
    importedAt: 1000,
    text: 'const a = 1;\nreturn a;',
    stats: { bytes: 22, files: 3, skipped: 1, lines: 2 },
    ...overrides,
  };
}

describe('saveTextSource and loadTextSource', () => {
  it('round-trips a source, stats and all', () => {
    const storage = new MemoryStorage();
    expect(saveTextSource(storage, source())).toEqual({ ok: true });

    const loaded = loadTextSource(storage);
    expect(loaded).toEqual(source());
  });

  it('is empty when nothing was ever stored', () => {
    expect(loadTextSource(new MemoryStorage())).toBeNull();
  });

  it('returns null rather than throwing on unreadable storage', () => {
    expect(loadTextSource(UNREADABLE_STORAGE)).toBeNull();
    expect(saveTextSource(UNREADABLE_STORAGE, source()).ok).toBe(false);
  });

  it('rejects a payload that is not a valid source', () => {
    const storage = new MemoryStorage();
    for (const raw of [
      'not json',
      '{}',
      '[]',
      '{"name":"a","importedAt":1}',
      '{"name":1,"importedAt":1,"text":"x"}',
      '{"name":"a","importedAt":"now","text":"x"}',
      '{"name":"a","importedAt":1,"text":""}',
    ]) {
      storage.setItem(TEXTSOURCE_KEY, raw);
      expect(loadTextSource(storage), raw).toBeNull();
    }
  });

  it('degrades a malformed stats block instead of failing the load', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      TEXTSOURCE_KEY,
      JSON.stringify({ name: 'a', importedAt: 5, text: 'hello\nthere', stats: 'nonsense' }),
    );

    const loaded = loadTextSource(storage);
    expect(loaded?.name).toBe('a');
    // Lines are recomputed from the text, so the view never shows a zero.
    expect(loaded?.stats).toEqual({ bytes: 11, files: 0, skipped: 0, lines: 2 });
  });

  it('refuses a source larger than the storage budget', () => {
    const storage = new MemoryStorage();
    const result = saveTextSource(storage, source({ text: 'x'.repeat(MAX_TEXTSOURCE_CHARS + 1) }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/larger than/);
    expect(storage.length).toBe(0);
  });

  it('reports a full storage as a failure rather than throwing', () => {
    const full: typeof UNREADABLE_STORAGE = {
      ...UNREADABLE_STORAGE,
      getItem: () => null,
    };
    const result = saveTextSource(full, source());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/SecurityError/);
  });
});

describe('removeTextSource', () => {
  it('deletes the source and leaves anything else alone', () => {
    const storage = new MemoryStorage();
    saveTextSource(storage, source());
    storage.setItem('yskeys:v1:store', 'keep me');

    removeTextSource(storage);

    expect(loadTextSource(storage)).toBeNull();
    expect(storage.getItem('yskeys:v1:store')).toBe('keep me');
  });

  it('is a no-op when there is nothing to remove', () => {
    const storage = new MemoryStorage();
    expect(() => {
      removeTextSource(storage);
    }).not.toThrow();
    expect(storage.length).toBe(0);
  });
});
