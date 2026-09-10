import { describe, expect, it } from 'vitest';
import { applyEvent, createSession } from '../core/engine';
import type { SessionState } from '../core/engine';
import {
  charsPerMinute,
  emptyMetric,
  median,
  mergeMetrics,
  rawAccuracy,
  recordAttempt,
  smoothedAccuracy,
  tallySession,
  weakestUnits,
  wordsPerMinute,
} from '../core/metrics';
import type { Metric } from '../core/metrics';

function play(target: string, keys: readonly string[]): SessionState {
  let state = createSession({ target, groupSize: target.length });
  let at = 100;
  for (const key of keys) {
    state = applyEvent(state, { type: 'key', key, at }).state;
    at += 100;
  }
  return state;
}

function metric(attempts: number, firstTryCorrect: number, wrongTyped: Record<string, number> = {}): Metric {
  return { attempts, firstTryCorrect, wrongTyped };
}

describe('rawAccuracy', () => {
  it('is null when there is nothing to divide by', () => {
    expect(rawAccuracy(0, 0)).toBeNull();
  });

  it('is the plain ratio otherwise', () => {
    expect(rawAccuracy(3, 4)).toBe(0.75);
    expect(rawAccuracy(0, 5)).toBe(0);
  });
});

describe('smoothedAccuracy', () => {
  it('returns the prior when there is no data', () => {
    expect(smoothedAccuracy(emptyMetric(), 5, 0.9)).toBe(0.9);
  });

  it('keeps a single wrong attempt well above 0', () => {
    expect(smoothedAccuracy(metric(1, 0), 5, 0.9)).toBeCloseTo(0.75, 10);
  });

  it('never reaches 1, even with a perfect record', () => {
    expect(smoothedAccuracy(metric(1000, 1000), 5, 0.9)).toBeLessThan(1);
  });

  it('rises as the record improves', () => {
    expect(smoothedAccuracy(metric(10, 10), 5, 0.9)).toBeGreaterThan(
      smoothedAccuracy(metric(1, 1), 5, 0.9),
    );
  });
});

describe('recordAttempt and mergeMetrics', () => {
  it('increments without mutating the input', () => {
    const before = metric(1, 1, { x: 2 });
    const after = recordAttempt(before, 'y', false);
    expect(before).toEqual(metric(1, 1, { x: 2 }));
    expect(after).toEqual(metric(2, 1, { x: 2, y: 1 }));
  });

  it('adds counters and confusion counts', () => {
    expect(mergeMetrics(metric(2, 1, { x: 1 }), metric(3, 3, { x: 2, y: 1 }))).toEqual(
      metric(5, 4, { x: 3, y: 1 }),
    );
  });

  it('does not mutate either operand', () => {
    const a = metric(1, 0, { x: 1 });
    const b = metric(1, 1);
    mergeMetrics(a, b);
    expect(a).toEqual(metric(1, 0, { x: 1 }));
    expect(b).toEqual(metric(1, 1));
  });
});

describe('speed', () => {
  it('reports characters per minute over a full minute', () => {
    expect(charsPerMinute(100, 60000)).toBe(100);
  });

  it('is null below the minimum window, rather than a wild number', () => {
    expect(charsPerMinute(10, 999)).toBeNull();
    expect(charsPerMinute(10, 0)).toBeNull();
  });

  it('treats five characters as one word', () => {
    expect(wordsPerMinute(100, 60000)).toBe(20);
    expect(wordsPerMinute(100, 500)).toBeNull();
  });
});

describe('median', () => {
  it('is null for no samples', () => {
    expect(median([])).toBeNull();
  });

  it('handles odd and even counts', () => {
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 3])).toBe(2);
  });

  it('does not mutate the input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('tallySession', () => {
  it('counts every unigram and every adjacent bigram once', () => {
    const tally = tallySession(play('abcde', ['a', 'b', 'c', 'd', 'e']));
    expect(tally.totals).toEqual({ attempts: 5, firstTryCorrect: 5, backspaces: 0 });
    for (const char of 'abcde') {
      expect(tally.unigrams[char]).toEqual(metric(1, 1));
    }
    expect(Object.keys(tally.bigrams).sort()).toEqual(['ab', 'bc', 'cd', 'de']);
    expect(tally.bigrams['ab']).toEqual(metric(1, 1));
  });

  it('files a miss under the expected unit, with what was actually typed', () => {
    const tally = tallySession(play('abcde', ['a', 'x', 'c']));
    expect(tally.unigrams['b']).toEqual(metric(1, 0, { x: 1 }));
    expect(tally.unigrams['a']).toEqual(metric(1, 1));
    expect(tally.totals).toEqual({ attempts: 3, firstTryCorrect: 2, backspaces: 0 });
    // A bigram is wrong if either half is wrong.
    expect(tally.bigrams['ab']).toEqual(metric(1, 0, { ax: 1 }));
    expect(tally.bigrams['bc']).toEqual(metric(1, 0, { xc: 1 }));
  });

  it('counts a bigram only when both positions were attempted', () => {
    const tally = tallySession(play('abcde', ['a', 'b']));
    expect(Object.keys(tally.bigrams)).toEqual(['ab']);
  });

  it('does not create a second sample when a position is retyped', () => {
    let state = play('ab', ['x']);
    state = applyEvent(state, { type: 'backspace', at: 900 }).state;
    state = applyEvent(state, { type: 'key', key: 'a', at: 950 }).state;
    const tally = tallySession(state);
    expect(tally.unigrams['a']).toEqual(metric(1, 0, { x: 1 }));
    expect(tally.totals.attempts).toBe(1);
    expect(tally.totals.backspaces).toBe(1);
  });

  it('is empty for an untouched session', () => {
    const tally = tallySession(createSession({ target: 'abc', groupSize: 3 }));
    expect(tally.totals.attempts).toBe(0);
    expect(tally.unigrams).toEqual({});
    expect(tally.bigrams).toEqual({});
  });
});

describe('weakestUnits', () => {
  it('reports nothing for a flawless session', () => {
    expect(weakestUnits(tallySession(play('abc', ['a', 'b', 'c'])), 5)).toEqual([]);
  });

  it('excludes units that were never missed', () => {
    const tally = tallySession(play('aab', ['x', 'y', 'b']));
    // 'b' was typed correctly and must not be listed; 'a', 'aa' and 'ab' were missed.
    expect(tally.unigrams['b']).toEqual(metric(1, 1));
    const units = weakestUnits(tally, 10);
    expect(units.map((unit) => unit.unit)).toEqual(['a', 'aa', 'ab']);
    expect(units.some((unit) => unit.unit === 'b')).toBe(false);
  });

  it('puts the unit with the most errors first', () => {
    const units = weakestUnits(tallySession(play('aab', ['x', 'y', 'b'])), 3);
    expect(units[0]?.unit).toBe('a');
    expect(units[0]?.errors).toBe(2);
    expect(units[0]?.kind).toBe('uni');
  });

  it('respects the limit and labels bigrams', () => {
    const units = weakestUnits(tallySession(play('ab', ['x', 'y'])), 3);
    expect(units).toHaveLength(3);
    expect(units.filter((unit) => unit.kind === 'bi').map((unit) => unit.unit)).toEqual(['ab']);
  });

  it('never returns more than the limit', () => {
    expect(weakestUnits(tallySession(play('ab', ['x', 'y'])), 1)).toHaveLength(1);
  });
});
