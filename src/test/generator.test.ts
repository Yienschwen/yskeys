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
    expect(drill.text).toHaveLength(150);
    expect(drill.text).toBe(drill.groups.join(''));
  });

  it('draws only from the enabled charsets', () => {
    const drill = buildUniformDrill({ ...baseSpec, charsets: ['digits'] });
    expect([...drill.text].every((char) => '0123456789'.includes(char))).toBe(true);
  });

  it('never repeats a character back to back', () => {
    const drill = buildUniformDrill(baseSpec);
    for (let index = 1; index < drill.text.length; index += 1) {
      expect(drill.text.charAt(index)).not.toBe(drill.text.charAt(index - 1));
    }
  });

  it('holds the no-repeat rule even for the smallest charset', () => {
    const drill = buildUniformDrill({
      ...baseSpec,
      charsets: ['punctuation'],
      groupCount: 40,
    });
    for (let index = 1; index < drill.text.length; index += 1) {
      expect(drill.text.charAt(index)).not.toBe(drill.text.charAt(index - 1));
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
    expect(new Set([...drill.text]).size).toBe(pool.length);
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
