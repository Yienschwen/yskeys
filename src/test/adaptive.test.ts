import { describe, expect, it } from 'vitest';
import { UNSEEN_WEIGHT } from '../config';
import {
  buildCandidates,
  coldStartCandidates,
  drawUnits,
  isColdStart,
  measuredCandidates,
  sampleCandidate,
  unitWeight,
} from '../core/adaptive';
import type { AdaptiveSource, Candidate } from '../core/adaptive';
import type { Metric } from '../core/metrics';
import { createRng } from '../core/random';

function metric(attempts: number, correct: number): Metric {
  return { attempts, firstTryCorrect: correct, wrongTyped: {} };
}

function source(
  unigrams: Record<string, Metric>,
  bigrams: Record<string, Metric> = {},
  charsets: readonly string[] = ['lowercase'],
): AdaptiveSource {
  return { unigrams, bigrams, charsets: charsets as AdaptiveSource['charsets'] };
}

/**
 * Counts draws with no in-session decay, which is the steady-state distribution the
 * weights describe. Decay is a per-session mechanism and is tested separately.
 */
function rawCounts(pool: readonly Candidate[], count: number, seed: number): Map<string, number> {
  const rng = createRng(seed);
  const counts = new Map<string, number>();
  let previous: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const candidate = sampleCandidate(
      pool,
      rng,
      previous === undefined ? {} : { avoid: previous },
    );
    counts.set(candidate.unit, (counts.get(candidate.unit) ?? 0) + 1);
    previous = candidate.unit;
  }
  return counts;
}

/**
 * A realistic pool for the acceptance criteria: 26 letters, of which `a` is bad, `b` is
 * near perfect and the rest are good. With only two candidates the "no repeat" rule
 * would force strict alternation and hide the weights entirely.
 */
function alphabetPool(): Candidate[] {
  const unigrams: Record<string, Metric> = { a: metric(100, 50), b: metric(100, 99) };
  for (const char of 'cdefghijklmnopqrstuvwxyz') {
    unigrams[char] = metric(100, 90);
  }
  return measuredCandidates(source(unigrams));
}

describe('unitWeight', () => {
  it('weighs a 50% unit far above a 99% one', () => {
    // 0.2313 vs the 0.01 floor: a factor of 23, which is what makes acceptance #6 reachable.
    expect(unitWeight(metric(100, 50))).toBeGreaterThan(unitWeight(metric(100, 99)) * 20);
  });

  it('keeps a strong unit at the floor, not at zero', () => {
    const strong = unitWeight(metric(1000, 1000));
    expect(strong).toBeGreaterThan(0);
    expect(strong).toBeLessThan(0.02);
  });
});

describe('candidates', () => {
  it('treats an unmeasured unit as mid-range: above a strong one, below a weak one', () => {
    const pool = measuredCandidates(
      source({ a: metric(100, 50), b: metric(100, 99) }),
      new Set(['a', 'b', 'c']),
    );
    const byUnit = new Map(pool.map((candidate) => [candidate.unit, candidate.weight]));

    expect(byUnit.get('c')).toBe(UNSEEN_WEIGHT);
    expect(byUnit.get('a') ?? 0).toBeGreaterThan(UNSEEN_WEIGHT);
    expect(byUnit.get('b') ?? 0).toBeLessThan(UNSEEN_WEIGHT);
  });

  it('only lets bigrams that have actually been observed compete', () => {
    const pool = measuredCandidates(
      source({ a: metric(5, 5) }, { ab: metric(0, 0), ac: metric(2, 1) }),
      new Set(['a', 'b', 'c', 'ab', 'ac']),
    );
    expect(pool.filter((candidate) => candidate.kind === 'bi').map((c) => c.unit)).toEqual(['ac']);
  });

  it('ignores units the enabled charsets cannot type', () => {
    const pool = measuredCandidates(
      source({ A: metric(3, 0) }, { aB: metric(3, 0) }, ['lowercase']),
    );
    expect(pool.every((candidate) => candidate.unit === candidate.unit.toLowerCase())).toBe(true);
    expect(pool.map((candidate) => candidate.unit)).not.toContain('A');
  });

  it('honours the availability filter, which is how un-drillable units stay out', () => {
    const pool = measuredCandidates(source({ a: metric(5, 0) }, {}, ['lowercase']), new Set(['a']));
    expect(pool.map((candidate) => candidate.unit)).toEqual(['a']);
  });
});

describe('cold start', () => {
  it('is detected only when nothing at all has been recorded', () => {
    expect(isColdStart(source({ a: metric(0, 0) }))).toBe(true);
    expect(isColdStart(source({}, { ab: metric(0, 0) }))).toBe(true);
    expect(isColdStart(source({ a: metric(1, 0) }))).toBe(false);
    expect(isColdStart(source({}, { ab: metric(1, 1) }))).toBe(false);
  });

  it('walks outwards from the home row', () => {
    const byUnit = new Map(coldStartCandidates(['lowercase']).map((c) => [c.unit, c.weight]));
    expect(byUnit.size).toBe(26);
    // f is home row, t is top row, v is bottom row.
    expect(byUnit.get('f') ?? 0).toBeGreaterThan(byUnit.get('t') ?? 0);
    expect(byUnit.get('t') ?? 0).toBeGreaterThan(byUnit.get('v') ?? 0);
    expect(byUnit.get('v') ?? 0).toBeGreaterThan(byUnit.get('1') ?? 0);
  });

  it('offers only single characters, since no pair has any evidence yet', () => {
    expect(coldStartCandidates(['lowercase']).every((candidate) => candidate.kind === 'uni')).toBe(
      true,
    );
  });

  it('leans away from Shift', () => {
    const plain = coldStartCandidates(['lowercase'])[0]?.weight ?? 0;
    const shifted = coldStartCandidates(['uppercase'])[0]?.weight ?? 0;
    expect(shifted).toBeLessThan(plain);
  });

  it('uses the cold-start prior only while there is no history', () => {
    expect(buildCandidates(source({ a: metric(0, 0) })).every((c) => c.attempts === 0)).toBe(true);
    expect(buildCandidates(source({ a: metric(2, 1) })).some((c) => c.attempts === 2)).toBe(true);
  });
});

describe('sampling (PROJECT.md acceptance #6 and #7)', () => {
  const pool = alphabetPool();

  it('draws the 50% unit at least 5x as often as the 99% unit (#6)', () => {
    const counts = rawCounts(pool, 10_000, 4242);
    const weak = counts.get('a') ?? 0;
    const strong = counts.get('b') ?? 0;

    expect(strong).toBeGreaterThan(0);
    expect(weak).toBeGreaterThanOrEqual(5 * strong);
  });

  it('gives every unit at least its exploration share, so nothing starves (#7)', () => {
    const counts = rawCounts(pool, 20_000, 11);
    // The uniform draw guarantees 0.15 / |pool| per unit; allow half for sampling noise.
    const floor = (20_000 * 0.15) / pool.length / 2;

    for (const candidate of pool) {
      expect(counts.get(candidate.unit) ?? 0, candidate.unit).toBeGreaterThan(floor);
    }
  });

  it('never draws the same unit twice in a row', () => {
    const drawn = drawUnits(pool, 500, createRng(7));
    for (let index = 1; index < drawn.length; index += 1) {
      expect(drawn[index]).not.toBe(drawn[index - 1]);
    }
  });

  it('refuses to draw from an empty pool', () => {
    expect(() => sampleCandidate([], createRng(1))).toThrow(/empty candidate pool/);
  });
});

describe('in-session decay', () => {
  it('spreads a session out instead of hammering the weakest unit', () => {
    const pool = alphabetPool();
    const withDecay = drawUnits(pool, 200, createRng(3));
    const counts = new Map<string, number>();
    for (const unit of withDecay) {
      counts.set(unit, (counts.get(unit) ?? 0) + 1);
    }

    const steady = rawCounts(pool, 200, 3).get('a') ?? 0;
    // Without decay the weak unit would take roughly 40% of 200 draws.
    expect(counts.get('a') ?? 0).toBeLessThan(steady);
    expect(counts.get('a') ?? 0).toBeGreaterThan(0);
  });
});
