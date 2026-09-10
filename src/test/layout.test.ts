import { describe, expect, it } from 'vitest';
import { CHARSETS } from '../core/charset';
import { KEY_LAYOUT, keyInfo } from '../core/layout';

describe('key layout', () => {
  it('maps every character of every charset', () => {
    for (const charset of CHARSETS) {
      for (const char of charset.chars) {
        expect(keyInfo(char), `missing layout for ${JSON.stringify(char)} (${charset.id})`).not.toBeNull();
      }
    }
  });

  it('knows every charset character plus the space bar', () => {
    expect(KEY_LAYOUT.size).toBe(95);
  });

  it('gives the space bar its own key, finger and kind', () => {
    expect(keyInfo(' ')?.finger).toBe('thumb');
    expect(keyInfo(' ')?.kind).toBe('space');
    expect(keyInfo(' ')?.shifted).toBe(false);
    expect(keyInfo(' ')?.row).toBe(5);
  });

  it('records every key in both its plain and shifted form, plus the space bar', () => {
    const values = [...KEY_LAYOUT.values()];
    // 47 physical keys, each in a plain and a shifted form, plus space (unshifted only).
    expect(values.filter((key) => !key.shifted)).toHaveLength(48);
    expect(values.filter((key) => key.shifted)).toHaveLength(47);
  });

  it('marks the shifted characters and only those', () => {
    expect(keyInfo('!')?.shifted).toBe(true);
    expect(keyInfo('~')?.shifted).toBe(true);
    expect(keyInfo('A')?.shifted).toBe(true);
    expect(keyInfo('1')?.shifted).toBe(false);
    expect(keyInfo('a')?.shifted).toBe(false);
    expect(keyInfo('`')?.shifted).toBe(false);
  });

  it('assigns fingers that agree with the hand', () => {
    expect(keyInfo('a')?.finger).toBe('l-pinky');
    expect(keyInfo('a')?.hand).toBe('left');
    expect(keyInfo('f')?.finger).toBe('l-index');
    expect(keyInfo('j')?.finger).toBe('r-index');
    expect(keyInfo('j')?.hand).toBe('right');
    expect(keyInfo('l')?.finger).toBe('r-ring');
    expect(keyInfo('q')?.finger).toBe('l-pinky');
    expect(keyInfo('p')?.finger).toBe('r-pinky');
  });

  it('gives a shifted and a plain character the same finger', () => {
    expect(keyInfo('1')?.finger).toBe(keyInfo('!')?.finger);
    expect(keyInfo('/')?.finger).toBe(keyInfo('?')?.finger);
    expect(keyInfo(';')?.finger).toBe(keyInfo(':')?.finger);
  });

  it('classifies kinds by charset, so the buckets match the settings toggles', () => {
    expect(keyInfo('a')?.kind).toBe('letter');
    expect(keyInfo('Z')?.kind).toBe('letter');
    expect(keyInfo('7')?.kind).toBe('digit');
    expect(keyInfo('?')?.kind).toBe('punctuation');
    expect(keyInfo('{')?.kind).toBe('symbol');
    // '/' is in the symbols charset and '?' in punctuation: the split is by charset,
    // not by what the character means.
    expect(keyInfo('/')?.kind).toBe('symbol');
  });

  it('places rows and columns inside the keyboard', () => {
    for (const key of KEY_LAYOUT.values()) {
      expect(key.row, key.char).toBeGreaterThanOrEqual(1);
      // Row 5 is the space bar, below the four character rows.
      expect(key.row, key.char).toBeLessThanOrEqual(5);
      expect(key.col, key.char).toBeGreaterThanOrEqual(0);
      expect(key.col, key.char).toBeLessThanOrEqual(12);
    }
  });

  it('returns null for characters that are not on the keyboard', () => {
    expect(keyInfo('中')).toBeNull();
    expect(keyInfo('')).toBeNull();
  });
});
