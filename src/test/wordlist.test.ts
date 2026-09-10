import { describe, expect, it } from 'vitest';
import { usableWords } from '../core/generator';
import { parseWordList } from '../core/wordlist';

/** Modelled on EFF's diceware files, which are the messiest real-world shape. */
const EFF_LIKE = [
  '# eff_short_wordlist_1.txt',
  '1111\tacid',
  '1112\tacorn',
  '',
  '1113 acre',
  '1114 acts',
  '66622\tyo-yo',
  '1111\tacid',
  'a',
  'naïve',
  'a lot',
  'x'.repeat(20),
].join('\r\n');

describe('parseWordList', () => {
  it('accepts every shape these files actually come in', () => {
    const result = parseWordList(EFF_LIKE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // Dice-number + tab, index + space, and a bare word per line all land the same way.
    expect(result.list.words).toEqual(['acid', 'acorn', 'acre', 'acts', 'yo-yo']);
    expect(result.list.kept).toBe(5);
  });

  it('reports what it threw away instead of dropping it silently', () => {
    const result = parseWordList(EFF_LIKE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // 'a' is too short, 'naïve' is not ASCII, 'a lot' has a space, the 20 x's are too long.
    expect(result.list.skipped).toBe(4);
    expect(result.list.duplicates).toBe(1);
  });

  it('does not count comments and blank lines as skipped', () => {
    const result = parseWordList('# just a comment\n\n\nacid\n');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.list.kept).toBe(1);
    expect(result.list.skipped).toBe(0);
  });

  it('strips a BOM and tolerates CRLF', () => {
    const result = parseWordList('\uFEFFacid\r\nacorn\r\n');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.list.words).toEqual(['acid', 'acorn']);
  });

  it('rejects a file with nothing usable in it', () => {
    const result = parseWordList('# only comments\n\n');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no usable words/);
    }
  });

  it('rejects an oversized file before doing any work', () => {
    const result = parseWordList('acid\n'.repeat(20), { maxChars: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too large/);
    }
  });

  it('keeps printable words the charsets cannot type, and leaves that filter for later', () => {
    const result = parseWordList('yo-yo\nacid\n');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.list.words).toContain('yo-yo');
    // The parser is permissive on purpose; usability depends on the current settings.
    expect(usableWords(result.list.words, ['lowercase'])).toEqual(['acid']);
  });

  it('drops words containing characters no drill could ever contain', () => {
    const result = parseWordList('acid\nwait\u00a0up\nfoo\tbar\n');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.list.words).toEqual(['acid', 'bar']);
  });
});
