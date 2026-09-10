import { describe, expect, it } from 'vitest';
import { createRng, randomInt } from '../core/random';

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 20 }, () => a())).toEqual(
      Array.from({ length: 20 }, () => b()),
    );
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 10 }, () => a())).not.toEqual(
      Array.from({ length: 10 }, () => b()),
    );
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let index = 0; index < 1000; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('accepts seed 0 without collapsing to a constant', () => {
    const rng = createRng(0);
    const values = Array.from({ length: 5 }, () => rng());
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});

describe('randomInt', () => {
  it('stays in range and reaches every value', () => {
    const rng = createRng(1234);
    const seen = new Set<number>();
    for (let index = 0; index < 2000; index += 1) {
      const value = randomInt(rng, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the bound %s', (bound) => {
    expect(() => randomInt(createRng(1), bound)).toThrow(/positive integer bound/);
  });
});
