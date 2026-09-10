import { MIN_SPEED_WINDOW_MS, SMOOTHING_ALPHA, SMOOTHING_PRIOR } from '../config';
import type { SessionState } from './engine';

/**
 * Accuracy, speed and per-unit tallies. `Metric` lives here rather than in
 * `store/` because it is a domain type: M2 only persists it.
 */

export interface Metric {
  attempts: number;
  firstTryCorrect: number;
  /** expected unit is the key; this maps the miss to what was actually typed. */
  wrongTyped: Record<string, number>;
}

export interface SessionTally {
  unigrams: Record<string, Metric>;
  bigrams: Record<string, Metric>;
  totals: {
    attempts: number;
    firstTryCorrect: number;
    backspaces: number;
  };
}

export interface WeakUnit {
  readonly unit: string;
  readonly kind: 'uni' | 'bi';
  readonly metric: Metric;
  readonly accuracy: number;
  readonly errors: number;
}

export function emptyMetric(): Metric {
  return { attempts: 0, firstTryCorrect: 0, wrongTyped: {} };
}

/** Pure increment; callers pass the previous metric (or `emptyMetric()`). */
export function recordAttempt(metric: Metric, typed: string, correct: boolean): Metric {
  const wrongTyped = { ...metric.wrongTyped };
  if (correct) {
    return {
      attempts: metric.attempts + 1,
      firstTryCorrect: metric.firstTryCorrect + 1,
      wrongTyped,
    };
  }
  wrongTyped[typed] = (wrongTyped[typed] ?? 0) + 1;
  return { attempts: metric.attempts + 1, firstTryCorrect: metric.firstTryCorrect, wrongTyped };
}

/** Used by M2's aggregate, and by `tallySession` to fold per-session counts. */
export function mergeMetrics(a: Metric, b: Metric): Metric {
  const wrongTyped = { ...a.wrongTyped };
  for (const [typed, count] of Object.entries(b.wrongTyped)) {
    wrongTyped[typed] = (wrongTyped[typed] ?? 0) + count;
  }
  return {
    attempts: a.attempts + b.attempts,
    firstTryCorrect: a.firstTryCorrect + b.firstTryCorrect,
    wrongTyped,
  };
}

/**
 * Folds a session's locked first attempts into unigram and bigram counts.
 *
 * Bigram rule (PROJECT.md §6.3): an adjacent pair counts once, and only be
 * correct if BOTH positions were correct on their first attempt. Re-typing after
 * a Backspace cannot create a second sample, because `firstAttempt` is immutable.
 */
export function tallySession(state: SessionState): SessionTally {
  const unigrams: Record<string, Metric> = {};
  const bigrams: Record<string, Metric> = {};
  let attempts = 0;
  let firstTryCorrect = 0;

  const indices = Object.keys(state.firstAttempt)
    .map(Number)
    .sort((a, b) => a - b);

  for (const index of indices) {
    const typed = state.firstAttempt[index];
    const expected = state.target.charAt(index);
    if (typed === undefined || expected === '') {
      continue;
    }
    const correct = typed === expected;
    unigrams[expected] = recordAttempt(unigrams[expected] ?? emptyMetric(), typed, correct);
    attempts += 1;
    if (correct) {
      firstTryCorrect += 1;
    }
  }

  for (let index = 0; index < state.target.length - 1; index += 1) {
    const first = state.firstAttempt[index];
    const second = state.firstAttempt[index + 1];
    if (first === undefined || second === undefined) {
      continue;
    }
    const expectedFirst = state.target.charAt(index);
    const expectedSecond = state.target.charAt(index + 1);
    const pair = expectedFirst + expectedSecond;
    const correct = first === expectedFirst && second === expectedSecond;
    bigrams[pair] = recordAttempt(bigrams[pair] ?? emptyMetric(), first + second, correct);
  }

  return {
    unigrams,
    bigrams,
    totals: { attempts, firstTryCorrect, backspaces: state.backspaces },
  };
}

/** Raw (unsmoothed) accuracy, or null when there is nothing to divide by. */
export function rawAccuracy(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total;
}

/**
 * Beta-smoothed accuracy (PROJECT.md F6): one attempt can never produce 0% or
 * 100%, so a unit is neither condemned nor trusted on a single sample.
 */
export function smoothedAccuracy(
  metric: Metric,
  alpha: number = SMOOTHING_ALPHA,
  prior: number = SMOOTHING_PRIOR,
): number {
  return (metric.firstTryCorrect + alpha * prior) / (metric.attempts + alpha);
}

export function charsPerMinute(correctChars: number, activeMs: number): number | null {
  if (activeMs < MIN_SPEED_WINDOW_MS) {
    return null;
  }
  return correctChars / (activeMs / 60000);
}

/** Standard definition: one "word" is five characters. */
export function wordsPerMinute(correctChars: number, activeMs: number): number | null {
  const cpm = charsPerMinute(correctChars, activeMs);
  return cpm === null ? null : cpm / 5;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  return lower === undefined || upper === undefined ? null : (lower + upper) / 2;
}

/**
 * Units worth practising, worst first. Units with no misses are excluded on
 * purpose: calling a 1-sample perfect unit "the weakest" would be a lie, so a
 * flawless session reports nothing rather than noise.
 */
export function weakestUnits(tally: SessionTally, limit: number): WeakUnit[] {
  const candidates: WeakUnit[] = [];

  for (const [unit, metric] of Object.entries(tally.unigrams)) {
    const errors = errorsIn(metric);
    if (errors > 0) {
      candidates.push({
        unit,
        kind: 'uni',
        metric,
        accuracy: metric.firstTryCorrect / metric.attempts,
        errors,
      });
    }
  }
  for (const [unit, metric] of Object.entries(tally.bigrams)) {
    const errors = errorsIn(metric);
    if (errors > 0) {
      candidates.push({
        unit,
        kind: 'bi',
        metric,
        accuracy: metric.firstTryCorrect / metric.attempts,
        errors,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.errors !== a.errors) {
      return b.errors - a.errors;
    }
    if (a.accuracy !== b.accuracy) {
      return a.accuracy - b.accuracy;
    }
    return b.metric.attempts - a.metric.attempts;
  });

  return candidates.slice(0, limit);
}

function errorsIn(metric: Metric): number {
  return metric.attempts - metric.firstTryCorrect;
}
