import { describe, expect, it } from 'vitest';
import { CHARSETS, charsFor, defaultCharsetIds, getCharset } from '../core/charset';
import type { CharsetId } from '../core/charset';

/** Built independently of the source data so this is a real check, not a tautology. */
const PRINTABLE_NON_SPACE = Array.from({ length: 94 }, (_, index) =>
  String.fromCharCode(33 + index),
).join('');

const sorted = (value: string): string => [...value].sort().join('');

describe('charset partition', () => {
  it('covers exactly the 94 printable non-space ASCII characters', () => {
    const union = CHARSETS.flatMap((charset) => [...charset.chars]).join('');
    expect(sorted(union)).toBe(sorted(PRINTABLE_NON_SPACE));
  });

  it('has no duplicate character inside a set', () => {
    for (const charset of CHARSETS) {
      expect(new Set(charset.chars).size, charset.id).toBe(charset.chars.length);
    }
  });

  it('shares no character between sets', () => {
    for (const a of CHARSETS) {
      for (const b of CHARSETS) {
        if (a.id === b.id) {
          continue;
        }
        const overlap = [...a.chars].filter((char) => b.chars.includes(char));
        expect(overlap, `${a.id} ∩ ${b.id}`).toEqual([]);
      }
    }
  });

  it('contains no whitespace and no non-ASCII character', () => {
    for (const charset of CHARSETS) {
      for (const char of charset.chars) {
        expect(char, charset.id).toMatch(/^[\x21-\x7e]$/);
      }
    }
  });

  it('uses unique ids and non-empty labels', () => {
    expect(new Set(CHARSETS.map((charset) => charset.id)).size).toBe(CHARSETS.length);
    for (const charset of CHARSETS) {
      expect(charset.label.length, charset.id).toBeGreaterThan(0);
    }
  });

  it('enables lowercase and nothing else by default', () => {
    expect(defaultCharsetIds()).toEqual(['lowercase']);
  });
});

describe('charsFor', () => {
  it('concatenates in the order requested', () => {
    expect(charsFor(['digits', 'lowercase'])).toBe(
      '0123456789abcdefghijklmnopqrstuvwxyz',
    );
  });

  it('returns an empty string when no set is enabled', () => {
    expect(charsFor([])).toBe('');
  });

  it('rejects an unknown id instead of silently returning nothing', () => {
    expect(() => getCharset('nope' as CharsetId)).toThrow(/unknown charset/);
  });
});
