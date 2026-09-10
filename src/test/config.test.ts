import { describe, expect, it } from 'vitest';
import * as config from '../config';

/**
 * These guard the invariants the adaptive algorithm depends on. If someone edits
 * config.ts and breaks one, the failure should surface here rather than as a
 * silently worse drill weeks later.
 */

describe('adaptive sampling constants', () => {
  it('makes the pool shares sum to exactly 1', () => {
    const total = config.WEAK_POOL_SHARE + config.MID_POOL_SHARE + config.RANDOM_SHARE;
    expect(total).toBeCloseTo(1, 10);
  });

  it('leaves a non-zero random share so strong units cannot be forgotten', () => {
    expect(config.RANDOM_SHARE).toBeGreaterThan(0);
  });

  it('keeps the weight floor above zero so no unit starves', () => {
    expect(config.WEIGHT_FLOOR).toBeGreaterThan(0);
  });

  it('boosts under-sampled units', () => {
    expect(config.SAMPLE_BOOST).toBeGreaterThan(1);
    expect(config.SAMPLE_BOOST_THRESHOLD).toBeGreaterThan(0);
  });

  it('uses a positive exponent', () => {
    expect(config.WEIGHT_EXPONENT).toBeGreaterThan(0);
  });

  it('keeps the weak pool a strict minority of units', () => {
    expect(config.WEAK_POOL_FRACTION).toBeGreaterThan(0);
    expect(config.WEAK_POOL_FRACTION).toBeLessThan(1);
  });

  it('uses a probability for embedding', () => {
    expect(config.EMBED_PROBABILITY).toBeGreaterThanOrEqual(0);
    expect(config.EMBED_PROBABILITY).toBeLessThanOrEqual(1);
  });
});

describe('accuracy smoothing', () => {
  it('uses a positive prior strength', () => {
    expect(config.SMOOTHING_ALPHA).toBeGreaterThan(0);
  });

  it('keeps the prior strictly inside (0, 1)', () => {
    expect(config.SMOOTHING_PRIOR).toBeGreaterThan(0);
    expect(config.SMOOTHING_PRIOR).toBeLessThan(1);
  });
});

describe('session shape', () => {
  it('offers the default group count as one of the choices', () => {
    expect(config.SESSION_GROUP_COUNTS).toContain(config.DEFAULT_GROUP_COUNT);
  });

  it('has a positive group size and sorted lengths', () => {
    expect(config.GROUP_SIZE).toBeGreaterThan(0);
    const counts = [...config.SESSION_GROUP_COUNTS];
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('keeps the idle threshold above the fastest plausible keystroke', () => {
    expect(config.IDLE_GAP_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('persistence limits', () => {
  it('keeps the payload guard under the localStorage ceiling', () => {
    // Measured in UTF-16 code units, which is how browsers account the ~5 MB quota.
    expect(config.MAX_PAYLOAD_CHARS).toBeGreaterThan(100_000);
    expect(config.MAX_PAYLOAD_CHARS).toBeLessThan(3_000_000);
  });

  it('allows a larger import than the store budget, but still bounds it', () => {
    expect(config.MAX_IMPORT_CHARS).toBeGreaterThan(config.MAX_PAYLOAD_CHARS);
    expect(config.MAX_IMPORT_CHARS).toBeLessThan(100_000_000);
  });

  it('namespaces the storage keys', () => {
    expect(config.STORAGE_KEY.startsWith('yskeys:')).toBe(true);
    expect(config.BACKUP_KEY_PREFIX.startsWith('yskeys:')).toBe(true);
    expect(config.CORRUPT_KEY_PREFIX.startsWith('yskeys:')).toBe(true);
  });

  it('hides noisy trigrams from the UI without refusing to store them', () => {
    expect(config.TRIGRAM_DISPLAY_MIN_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });

  it('offers bounded table and chart sizes', () => {
    expect(config.WEAK_TABLE_LIMIT).toBeGreaterThan(0);
    expect(config.RESULT_WEAK_LIMIT).toBeGreaterThan(0);
    expect(config.CHART_MAX_POINTS).toBeGreaterThan(1);
  });
});

describe('keyboard shortcuts', () => {
  it('never claims Tab', () => {
    expect([config.RESTART_KEY, config.NEXT_SESSION_KEY]).not.toContain('Tab');
  });
});
