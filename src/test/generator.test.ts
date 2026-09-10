import { describe, expect, it } from 'vitest';
import { WORD_MAX_LENGTH } from '../config';
import { charsFor, defaultCharsetIds } from '../core/charset';
import type { CharsetId } from '../core/charset';
import {
  buildAdaptiveDrill,
  buildUniformDrill,
  buildWordDrill,
  buildWordIndex,
  embedUnit,
  isWordListUsable,
  materializeUnit,
  usableWords,
} from '../core/generator';
import type { SessionSpec, Drill } from '../core/generator';
import { createRng } from '../core/random';

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

describe('buildWordIndex and materializeUnit', () => {
  it('indexes single characters and adjacent pairs', () => {
    const index = buildWordIndex(['the', 'them']);
    expect(index.get('th')).toEqual([0, 1]);
    expect(index.get('he')).toEqual([0, 1]);
    expect(index.get('e')).toEqual([0, 1]);
    expect(index.get('hh')).toBeUndefined();
  });

  it('keeps the drawn unit contiguous when it embeds it', () => {
    const rng = createRng(21);
    for (let index = 0; index < 300; index += 1) {
      const group = embedUnit('th', ['lowercase'], rng);
      expect(group, group).toContain('th');
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(group.length).toBeLessThanOrEqual(5);
    }
  });

  it('targets a 3-5 character group rather than a fragment', () => {
    const rng = createRng(5);
    const lengths = Array.from({ length: 200 }, () => embedUnit('a', ['lowercase'], rng).length);
    const embedded = lengths.filter((length) => length > 1);
    expect(embedded.length).toBeGreaterThan(100);
    const average = embedded.reduce((total, length) => total + length, 0) / embedded.length;
    expect(average).toBeGreaterThan(3);
  });

  it('returns a word containing the unit, and falls back when no word has it', () => {
    const words = ['acid', 'acorn', 'bread'];
    const context = {
      shape: 'words' as const,
      charsets: ['lowercase'] as const,
      words,
      index: buildWordIndex(words),
      rng: createRng(2),
    };
    expect(materializeUnit('ac', context)).toContain('ac');
    expect(words).toContain(materializeUnit('zz', context));
  });
});

describe('buildAdaptiveDrill', () => {
  const source = {
    unigrams: { a: { attempts: 50, firstTryCorrect: 10, wrongTyped: {} } },
    bigrams: {},
    charsets: ['lowercase'] as const,
  };

  it('reaches the character target with character groups', () => {
    const drill = buildAdaptiveDrill({
      shape: 'uniform',
      charsets: ['lowercase'],
      targetChars: 40,
      source,
      seed: 3,
    });

    expect(drill.text.replaceAll(' ', '').length).toBeGreaterThanOrEqual(40);
    expect(drill.text).toBe(drill.groups.join(' '));
    expect(drill.groups.every((group) => group.length >= 1 && group.length <= 5)).toBe(true);
  });

  it('produces a different drill when the weakness moves to another unit', () => {
    const build = (weak: 'a' | 'b'): Drill =>
      buildAdaptiveDrill({
        shape: 'uniform',
        charsets: ['lowercase'],
        targetChars: 120,
        source: {
          unigrams: {
            a: { attempts: 100, firstTryCorrect: weak === 'a' ? 50 : 100, wrongTyped: {} },
            b: { attempts: 100, firstTryCorrect: weak === 'b' ? 50 : 100, wrongTyped: {} },
          },
          bigrams: {},
          charsets: ['lowercase'],
        },
        seed: 8,
      });

    // The distribution itself is proven in adaptive.test.ts over 10,000 draws; here it
    // only has to be visible that the recorded history is what drives the drill.
    expect(build('a').text).not.toBe(build('b').text);
  });

  it('only emits words that can satisfy the drawn unit', () => {
    const words = ['quick', 'queen', 'quiet', 'other', 'thing'];
    const drill = buildAdaptiveDrill({
      shape: 'words',
      charsets: ['lowercase'],
      targetChars: 30,
      words,
      // q has no word in the list below, so it must not be drawable here.
      source: {
        unigrams: { q: { attempts: 20, firstTryCorrect: 1, wrongTyped: {} } },
        bigrams: {},
        charsets: ['lowercase'],
      },
      seed: 4,
    });

    // Nothing in the list contains a q other than the q words themselves, so the pool
    // collapses to the units of the available words.
    expect(drill.text.replaceAll(' ', '').length).toBeGreaterThanOrEqual(30);
    expect(drill.groups.every((word) => words.includes(word))).toBe(true);
  });

  it('refuses to build when no unit can be materialized', () => {
    expect(() =>
      buildAdaptiveDrill({
        shape: 'words',
        charsets: ['lowercase'],
        targetChars: 30,
        words: [],
        source,
        seed: 1,
      }),
    ).toThrow(/no units are available/);
  });
});
