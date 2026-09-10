import { describe, expect, it } from 'vitest';
import type { Metric } from '../core/metrics';
import {
  createSessionId,
  defaultSettings,
  defaultStore,
  isAggregates,
  isCharsetIdArray,
  isFiniteNumber,
  isMetric,
  isMetricMap,
  isRecord,
  isSessionSummary,
  isSettings,
  isWorstUnit,
} from '../store/schema';

/**
 * These validators are the trust boundary for imported files: everything that a
 * hand-edited or foreign JSON can contain has to be rejected here, not three layers
 * deeper where the failure would be a confusing crash.
 */

const validMetric: Metric = { attempts: 2, firstTryCorrect: 1, wrongTyped: { x: 1 } };

describe('isRecord and isFiniteNumber', () => {
  it('accepts plain objects and rejects arrays, null, functions and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(1)).toBe(false);
  });

  it('rejects NaN and Infinity but accepts zero and negatives', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(-3)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber('3')).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
  });
});

describe('isMetric', () => {
  it('accepts a well-formed metric', () => {
    expect(isMetric(validMetric)).toBe(true);
    expect(isMetric({ attempts: 0, firstTryCorrect: 0, wrongTyped: {} })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMetric(null)).toBe(false);
    expect(isMetric({})).toBe(false);
    expect(isMetric({ attempts: 1, firstTryCorrect: 0 })).toBe(false);
    // More correct answers than attempts is impossible, so it is malformed.
    expect(isMetric({ attempts: 1, firstTryCorrect: 2, wrongTyped: {} })).toBe(false);
    expect(isMetric({ attempts: '1', firstTryCorrect: 0, wrongTyped: {} })).toBe(false);
    expect(isMetric({ attempts: 1, firstTryCorrect: 0, wrongTyped: [] })).toBe(false);
    expect(isMetric({ attempts: 1, firstTryCorrect: 0, wrongTyped: { x: 'y' } })).toBe(false);
    expect(isMetric({ attempts: Number.NaN, firstTryCorrect: 0, wrongTyped: {} })).toBe(false);
  });

  it('validates every entry of a map', () => {
    expect(isMetricMap({ a: validMetric })).toBe(true);
    expect(isMetricMap({})).toBe(true);
    expect(isMetricMap({ a: validMetric, b: null })).toBe(false);
    expect(isMetricMap([])).toBe(false);
  });
});

describe('isCharsetIdArray', () => {
  it('accepts known ids without duplicates', () => {
    expect(isCharsetIdArray(['lowercase'])).toBe(true);
    expect(isCharsetIdArray(['lowercase', 'symbols'])).toBe(true);
    expect(isCharsetIdArray([])).toBe(true);
  });

  it('rejects unknown ids, duplicates and non-arrays', () => {
    expect(isCharsetIdArray(['bogus'])).toBe(false);
    expect(isCharsetIdArray(['lowercase', 'lowercase'])).toBe(false);
    expect(isCharsetIdArray('lowercase')).toBe(false);
    expect(isCharsetIdArray([1])).toBe(false);
  });
});

describe('isSettings', () => {
  it('accepts the defaults', () => {
    expect(isSettings(defaultSettings())).toBe(true);
  });

  it('rejects a selection that could not produce a drill', () => {
    expect(isSettings({ charsets: [], groupCount: 30 })).toBe(false);
    expect(isSettings({ charsets: ['lowercase'], groupCount: 0 })).toBe(false);
    expect(isSettings({ charsets: ['lowercase'], groupCount: -1 })).toBe(false);
    expect(isSettings({ charsets: ['lowercase'], groupCount: '30' })).toBe(false);
    expect(isSettings({ charsets: ['nope'], groupCount: 30 })).toBe(false);
    expect(isSettings(null)).toBe(false);
    expect(isSettings({})).toBe(false);
  });

  it('accepts a missing drill shape but not an unknown one', () => {
    expect(isSettings({ charsets: ['lowercase'], groupCount: 30 })).toBe(true);
    expect(isSettings({ charsets: ['lowercase'], groupCount: 30, shape: 'words' })).toBe(true);
    expect(isSettings({ charsets: ['lowercase'], groupCount: 30, shape: 'uniform' })).toBe(true);
    expect(isSettings({ charsets: ['lowercase'], groupCount: 30, shape: 'poetry' })).toBe(false);
  });
});

describe('isWorstUnit', () => {
  it('accepts uni and bi entries only', () => {
    expect(isWorstUnit({ unit: 'a', kind: 'uni', attempts: 2, errors: 1 })).toBe(true);
    expect(isWorstUnit({ unit: 'ab', kind: 'bi', attempts: 2, errors: 1 })).toBe(true);
    expect(isWorstUnit({ unit: 'a', kind: 'tri', attempts: 2, errors: 1 })).toBe(false);
    expect(isWorstUnit({ unit: 1, kind: 'uni', attempts: 2, errors: 1 })).toBe(false);
    expect(isWorstUnit({ unit: 'a', kind: 'uni', attempts: '2', errors: 1 })).toBe(false);
    expect(isWorstUnit(null)).toBe(false);
  });
});

describe('isSessionSummary', () => {
  const sample = {
    id: 's-1',
    startedAt: 1000,
    durationMs: 1200,
    mode: 'uniform',
    charsets: ['lowercase'],
    totalChars: 150,
    attempts: 150,
    firstTryCorrect: 140,
    backspaces: 3,
    cpm: 200,
    wpm: 40,
    medianIntervalMs: 180,
    worstUnits: [],
  };

  it('accepts a complete summary, and one with null speeds', () => {
    expect(isSessionSummary(sample)).toBe(true);
    expect(isSessionSummary({ ...sample, cpm: null, wpm: null, medianIntervalMs: null })).toBe(true);
    expect(isSessionSummary({ ...sample, worstUnits: [{ unit: 'a', kind: 'uni', attempts: 1, errors: 1 }] })).toBe(true);
  });

  it('rejects the fields that the history view depends on', () => {
    expect(isSessionSummary(null)).toBe(false);
    expect(isSessionSummary({ ...sample, id: '' })).toBe(false);
    expect(isSessionSummary({ ...sample, id: 7 })).toBe(false);
    expect(isSessionSummary({ ...sample, mode: 'sprint' })).toBe(false);
    expect(isSessionSummary({ ...sample, charsets: [] })).toBe(true);
    expect(isSessionSummary({ ...sample, charsets: ['nope'] })).toBe(false);
    expect(isSessionSummary({ ...sample, attempts: '150' })).toBe(false);
    expect(isSessionSummary({ ...sample, cpm: 'fast' })).toBe(false);
    expect(isSessionSummary({ ...sample, worstUnits: [{}] })).toBe(false);
    expect(isSessionSummary({ ...sample, worstUnits: 'none' })).toBe(false);
    expect(isSessionSummary({ ...sample, startedAt: Number.NaN })).toBe(false);
  });

  it('accepts a missing drill shape but not an unknown one', () => {
    expect(isSessionSummary({ ...sample, shape: 'words' })).toBe(true);
    expect(isSessionSummary({ ...sample, shape: 'uniform' })).toBe(true);
    expect(isSessionSummary({ ...sample, shape: 'poetry' })).toBe(false);
  });
});

describe('isAggregates', () => {
  it('accepts an empty aggregate set', () => {
    expect(isAggregates(defaultStore(0).aggregates)).toBe(true);
  });

  it('requires every dimension, so a partial file cannot silently drop samples', () => {
    const aggregates = defaultStore(0).aggregates;
    for (const key of [
      'unigrams',
      'bigrams',
      'trigrams',
      'byFinger',
      'byHand',
      'byShifted',
      'byKind',
    ]) {
      const partial = { ...aggregates } as Record<string, unknown>;
      delete partial[key];
      expect(isAggregates(partial), `missing ${key} was accepted`).toBe(false);
    }
  });

  it('rejects missing counters and malformed maps', () => {
    const aggregates = defaultStore(0).aggregates;
    expect(isAggregates({ ...aggregates, totalSessions: 'many' })).toBe(false);
    expect(isAggregates({ ...aggregates, unigrams: { a: null } })).toBe(false);
    expect(isAggregates([])).toBe(false);
    expect(isAggregates(null)).toBe(false);
  });
});

describe('createSessionId', () => {
  it('is deterministic for the same inputs', () => {
    expect(createSessionId(1000, 1)).toBe(createSessionId(1000, 1));
  });

  it('differs across time and sequence, without needing a secure context', () => {
    expect(createSessionId(1000, 1)).not.toBe(createSessionId(1001, 1));
    expect(createSessionId(1000, 1)).not.toBe(createSessionId(1000, 2));
    expect(createSessionId(1000, 1)).toMatch(/^s-[0-9a-z]+-[0-9a-z]+$/);
  });

  it('survives a negative or fractional sequence', () => {
    expect(createSessionId(1000, -5)).toMatch(/^s-[0-9a-z]+-0$/);
    expect(createSessionId(1000, 1.7)).toMatch(/^s-[0-9a-z]+-1$/);
  });
});
