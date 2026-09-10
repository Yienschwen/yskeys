import { describe, expect, it } from 'vitest';
import { charsFor, defaultCharsetIds } from '../core/charset';
import { buildUniformDrill } from '../core/generator';
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
