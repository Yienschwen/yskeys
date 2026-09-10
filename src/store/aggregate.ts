import { MAX_SESSION_SUMMARIES, SCHEMA_VERSION } from '../config';
import type { SessionState } from '../core/engine';
import type { DrillShape } from '../core/generator';
import {
  charsPerMinute,
  median,
  mergeMetricMaps,
  weakestUnits,
  wordsPerMinute,
} from '../core/metrics';
import type { SessionTally } from '../core/metrics';
import type { Aggregates, SessionSummary, Settings, Store, WorstUnit } from './schema';

/**
 * Folding a finished session into the store. Pure: no storage, and the only clock is
 * the `now` the caller passes, so "did the counters move exactly once?" is a test
 * rather than a manual check (PROJECT.md acceptance #3).
 */

export function applySession(
  store: Store,
  summary: SessionSummary,
  tally: SessionTally,
  now: number,
): Store {
  const aggregates: Aggregates = {
    ...store.aggregates,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: now,
    totalSessions: store.aggregates.totalSessions + 1,
    totalKeystrokes: store.aggregates.totalKeystrokes + tally.totals.attempts,
    unigrams: mergeMetricMaps(store.aggregates.unigrams, tally.unigrams),
    bigrams: mergeMetricMaps(store.aggregates.bigrams, tally.bigrams),
    trigrams: mergeMetricMaps(store.aggregates.trigrams, tally.trigrams),
    byFinger: mergeMetricMaps(store.aggregates.byFinger, tally.byFinger),
    byHand: mergeMetricMaps(store.aggregates.byHand, tally.byHand),
    byShifted: mergeMetricMaps(store.aggregates.byShifted, tally.byShifted),
    byKind: mergeMetricMaps(store.aggregates.byKind, tally.byKind),
  };
  return {
    ...store,
    schemaVersion: SCHEMA_VERSION,
    aggregates,
    sessions: capSessions([summary, ...store.sessions]),
  };
}

/** Newest first, capped. Shared by `applySession` and by import. */
export function capSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_SESSION_SUMMARIES);
}

export interface SessionSummaryInput {
  readonly state: SessionState;
  readonly tally: SessionTally;
  readonly settings: Settings;
  readonly id: string;
  readonly startedAt: number;
  readonly mode: 'adaptive' | 'uniform';
  readonly shape: DrillShape;
  readonly worstLimit: number;
}

export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  const { state, tally } = input;
  const correct = tally.totals.firstTryCorrect;
  const worstUnits: WorstUnit[] = weakestUnits(tally, input.worstLimit).map((unit) => ({
    unit: unit.unit,
    kind: unit.kind,
    attempts: unit.metric.attempts,
    errors: unit.errors,
  }));

  return {
    id: input.id,
    startedAt: input.startedAt,
    durationMs: state.activeMs,
    mode: input.mode,
    shape: input.shape,
    charsets: [...input.settings.charsets],
    totalChars: state.target.length,
    attempts: tally.totals.attempts,
    firstTryCorrect: correct,
    backspaces: tally.totals.backspaces,
    cpm: charsPerMinute(correct, state.activeMs),
    wpm: wordsPerMinute(correct, state.activeMs),
    medianIntervalMs: median(state.intervals),
    worstUnits,
  };
}
