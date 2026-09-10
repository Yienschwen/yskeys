import { describe, expect, it } from 'vitest';
import { WORD_MAX_LENGTH } from '../config';
import { charsFor, defaultCharsetIds } from '../core/charset';
import type { CharsetId } from '../core/charset';
import { buildUniformDrill, buildWordDrill, isWordListUsable, usableWords } from '../core/generator';
import type { SessionSpec } from '../core/generator';

const baseSpec: SessionSpec = {
  charsets: defaultCharsetIds(),
  groupCount: 30,
  groupSize: 5,
  seed: 99,
};

describe('buildUniformDrill', () => {
  it('produces exactly groupCount groups of groupSize characters', () => {
    const drill = buildUniformDrill(baseSpec);
    expect(drill.groups).toHaveLength(30);
    for (const group of drill.groups) {
      expect(group).toHaveLength(5);
    }
    expect(drill.text).toHaveLength(179);
    expect(drill.text).toBe(drill.groups.join(' '));
  });

  it('draws only from the enabled charsets', () => {
    const drill = buildUniformDrill({ ...baseSpec, charsets: ['digits'] });
    expect([...drill.text].every((char) => char === ' ' || '0123456789'.includes(char))).toBe(true);
  });

  it('never repeats a character back to back inside a group', () => {
    const drill = buildUniformDrill(baseSpec);
    for (const group of drill.groups) {
      for (let index = 1; index < group.length; index += 1) {
        expect(group.charAt(index)).not.toBe(group.charAt(index - 1));
      }
    }
  });

  it('separates groups with exactly one real space', () => {
    const drill = buildUniformDrill(baseSpec);
    expect(drill.groups).toHaveLength(30);
    expect(drill.text).toBe(drill.groups.join(' '));
    expect(drill.text).not.toContain('  ');
    expect(drill.text.startsWith(' ')).toBe(false);
    expect(drill.text.endsWith(' ')).toBe(false);
    // 30 groups of 5 plus the 29 spaces between them.
    expect(drill.text.length).toBe(30 * 5 + 29);
  });

  it('holds the no-repeat rule even for the smallest charset', () => {
    const drill = buildUniformDrill({
      ...baseSpec,
      charsets: ['punctuation'],
      groupCount: 40,
    });
    for (const group of drill.groups) {
      for (let index = 1; index < group.length; index += 1) {
        expect(group.charAt(index)).not.toBe(group.charAt(index - 1));
      }
    }
  });

  it('is reproducible from the seed', () => {
    expect(buildUniformDrill(baseSpec).text).toBe(buildUniformDrill(baseSpec).text);
  });

  it('changes when the seed changes', () => {
    expect(buildUniformDrill({ ...baseSpec, seed: 1 }).text).not.toBe(
      buildUniformDrill({ ...baseSpec, seed: 2 }).text,
    );
  });

  it('eventually uses every character of the pool', () => {
    const pool = charsFor(['lowercase']);
    const drill = buildUniformDrill({
      charsets: ['lowercase'],
      groupCount: 60,
      groupSize: 5,
      seed: 5,
    });
    expect(new Set([...drill.text].filter((char) => char !== ' ')).size).toBe(pool.length);
  });

  it('rejects an empty charset selection', () => {
    expect(() => buildUniformDrill({ ...baseSpec, charsets: [] })).toThrow(/empty charset/);
  });

  it.each([0, -3, 2.5])('rejects groupCount %s', (groupCount) => {
    expect(() => buildUniformDrill({ ...baseSpec, groupCount })).toThrow(/groupCount/);
  });

  it.each([0, -1, 1.5])('rejects groupSize %s', (groupSize) => {
    expect(() => buildUniformDrill({ ...baseSpec, groupSize })).toThrow(/groupSize/);
  });
});

describe('buildWordDrill', () => {
  const WORDS = ['acid', 'acorn', 'acre', 'acts', 'amber', 'banana', 'cider', 'delta', 'ember', 'fable'];
  const spec = { charsets: ['lowercase'] as CharsetId[], targetChars: 30, words: WORDS, seed: 7 };

  it('keeps drawing words until the character target is reached', () => {
    const drill = buildWordDrill(spec);
    const letters = drill.text.replaceAll(' ', '').length;

    expect(letters).toBeGreaterThanOrEqual(30);
    // One word may overshoot the target, but not by a whole word more.
    expect(letters).toBeLessThan(30 + WORD_MAX_LENGTH);
    expect(drill.groups.length).toBeGreaterThanOrEqual(6);
  });

  it('separates words with exactly one real space', () => {
    const drill = buildWordDrill(spec);
    expect(drill.text).toBe(drill.groups.join(' '));
    expect(drill.text).not.toContain('  ');
    expect(drill.text.startsWith(' ')).toBe(false);
    expect(drill.text.endsWith(' ')).toBe(false);
  });

  it('never repeats a word back to back', () => {
    const drill = buildWordDrill({ ...spec, targetChars: 200 });
    for (let index = 1; index < drill.groups.length; index += 1) {
      expect(drill.groups[index]).not.toBe(drill.groups[index - 1]);
    }
  });

  it('is reproducible from the seed and varies with it', () => {
    expect(buildWordDrill(spec).text).toBe(buildWordDrill(spec).text);
    expect(buildWordDrill({ ...spec, seed: 1 }).text).not.toBe(
      buildWordDrill({ ...spec, seed: 2 }).text,
    );
  });

  it('lowercases everything when only lowercase is enabled', () => {
    const drill = buildWordDrill({ ...spec, words: ['Acid', 'ACORN', 'acre'], targetChars: 60 });
    expect(drill.groups.every((word) => word === word.toLowerCase())).toBe(true);
  });

  it('uppercases everything when only uppercase is enabled', () => {
    const drill = buildWordDrill({
      ...spec,
      charsets: ['uppercase'],
      words: ['acid', 'acorn', 'acre'],
      targetChars: 60,
    });
    expect(drill.groups.every((word) => word === word.toUpperCase())).toBe(true);
  });

  it('title-cases some words when both cases are on, and never capitalises mid-word', () => {
    const drill = buildWordDrill({
      ...spec,
      charsets: ['lowercase', 'uppercase'],
      targetChars: 400,
    });
    const capitalised = drill.groups.filter((word) => /^[A-Z]/.test(word));

    expect(capitalised.length).toBeGreaterThan(0);
    expect(capitalised.length).toBeLessThan(drill.groups.length);
    for (const word of drill.groups) {
      expect(word.slice(1)).toBe(word.slice(1).toLowerCase());
    }
  });

  it('drops words the enabled charsets cannot type', () => {
    const drill = buildWordDrill({
      ...spec,
      words: ['acid', 'a1b2', 'yo-yo', 'ab'],
      targetChars: 8,
    });
    expect(drill.groups.length).toBeGreaterThan(0);
    expect(drill.groups.every((word) => /^[a-z]+$/.test(word))).toBe(true);
  });

  it('refuses to build from a pool with nothing usable', () => {
    expect(() => buildWordDrill({ ...spec, charsets: ['digits'] })).toThrow(/without usable words/);
  });
});

describe('usableWords and isWordListUsable', () => {
  it('filters by length and by the enabled letters, ignoring case', () => {
    const words = ['a', 'ab', 'acid', 'Acid', 'a1b', 'yo-yo', 'x'.repeat(20)];
    expect(usableWords(words, ['lowercase'])).toEqual(['ab', 'acid', 'Acid']);
  });

  it('needs a floor of usable words before the words shape is worth offering', () => {
    const many = Array.from(
      { length: 25 },
      (_, index) => `word${String.fromCharCode(97 + (index % 26))}`,
    );
    expect(new Set(many).size).toBe(25);
    expect(isWordListUsable(many, ['lowercase'])).toBe(true);
    expect(isWordListUsable(many.slice(0, 24), ['lowercase'])).toBe(false);
  });

  it('is unusable when no letter charset is enabled', () => {
    expect(usableWords(['acid'], ['digits'])).toEqual([]);
    expect(isWordListUsable(['acid'], ['digits'])).toBe(false);
  });
});
