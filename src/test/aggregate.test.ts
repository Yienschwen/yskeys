import { describe, expect, it } from 'vitest';
import { MAX_SESSION_SUMMARIES, RESULT_WEAK_LIMIT } from '../config';
import { tallySession } from '../core/metrics';
import { applySession, buildSessionSummary, capSessions } from '../store/aggregate';
import { createSessionId, defaultSettings, defaultStore } from '../store/schema';
import type { SessionSummary } from '../store/schema';
import { playState } from './helpers';

function sessionFor(target: string, keys: readonly string[], startedAt = 1000, step = 100) {
  const state = playState(target, keys, { startAt: startedAt, step });
  const tally = tallySession(state);
  const summary = buildSessionSummary({
    state,
    tally,
    settings: defaultSettings(),
    id: createSessionId(startedAt, 1),
    startedAt,
    mode: 'uniform',
    shape: 'uniform',
    worstLimit: RESULT_WEAK_LIMIT,
  });
  return { state, tally, summary };
}

describe('applySession', () => {
  it('adds the session to every dimension exactly once', () => {
    const store = defaultStore(0);
    const { tally, summary } = sessionFor('afJ7', ['a', 'f', 'J', '7']);
    const next = applySession(store, summary, tally, 10);

    expect(next.aggregates.totalSessions).toBe(1);
    expect(next.aggregates.totalKeystrokes).toBe(4);
    expect(next.aggregates.updatedAt).toBe(10);
    expect(next.aggregates.createdAt).toBe(0);
    expect(next.aggregates.unigrams['a']).toEqual({
      attempts: 1,
      firstTryCorrect: 1,
      wrongTyped: {},
    });
    expect(next.aggregates.byFinger['l-pinky']?.attempts).toBe(1);
    expect(next.aggregates.byFinger['r-index']?.attempts).toBe(2);
    expect(next.aggregates.byHand['left']?.attempts).toBe(2);
    expect(next.aggregates.byHand['right']?.attempts).toBe(2);
    expect(next.aggregates.byShifted['shifted']?.attempts).toBe(1);
    expect(next.aggregates.byShifted['plain']?.attempts).toBe(3);
    expect(next.aggregates.byKind['digit']?.attempts).toBe(1);
    expect(next.aggregates.trigrams['afJ']?.attempts).toBe(1);
    expect(next.sessions).toHaveLength(1);
  });

  it('does not mutate the store it was given', () => {
    const store = defaultStore(0);
    const before = JSON.stringify(store);
    const { tally, summary } = sessionFor('a', ['a']);
    applySession(store, summary, tally, 10);
    expect(JSON.stringify(store)).toBe(before);
  });

  it('accumulates across sessions, newest session first', () => {
    let store = defaultStore(0);
    const first = sessionFor('aa', ['a', 'a'], 1000);
    store = applySession(store, first.summary, first.tally, 10);
    const second = sessionFor('aa', ['a', 'x'], 2000);
    store = applySession(store, second.summary, second.tally, 20);

    expect(store.aggregates.totalSessions).toBe(2);
    expect(store.aggregates.totalKeystrokes).toBe(4);
    // Target 'aa' means the first session alone contributes two 'a' samples.
    expect(store.aggregates.unigrams['a']).toEqual({
      attempts: 4,
      firstTryCorrect: 3,
      wrongTyped: { x: 1 },
    });
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0]?.startedAt).toBe(2000);
  });
});

describe('buildSessionSummary', () => {
  it('records speed, worst units and the settings in force', () => {
    const state = playState('afJ7', ['a', 'f', 'J', 'x'], { startAt: 1000, step: 400 });
    const tally = tallySession(state);
    const summary = buildSessionSummary({
      state,
      tally,
      settings: defaultSettings(),
      id: 's-test-1',
      startedAt: 1000,
      mode: 'uniform',
      shape: 'uniform',
      worstLimit: RESULT_WEAK_LIMIT,
    });

    expect(summary.id).toBe('s-test-1');
    expect(summary.mode).toBe('uniform');
    expect(summary.totalChars).toBe(4);
    expect(summary.attempts).toBe(4);
    expect(summary.firstTryCorrect).toBe(3);
    expect(summary.durationMs).toBe(1200);
    expect(summary.cpm).toBeCloseTo(150, 6);
    expect(summary.wpm).toBeCloseTo(30, 6);
    expect(summary.charsets).toEqual(['lowercase']);
    expect(summary.worstUnits.map((unit) => unit.unit)).toContain('7');
  });

  it('reports null speed for a session shorter than the minimum window', () => {
    const state = playState('af', ['a', 'f'], { startAt: 1000, step: 10 });
    const summary = buildSessionSummary({
      state,
      tally: tallySession(state),
      settings: defaultSettings(),
      id: 's-test-2',
      startedAt: 1000,
      mode: 'uniform',
      shape: 'uniform',
      worstLimit: RESULT_WEAK_LIMIT,
    });
    expect(summary.cpm).toBeNull();
    expect(summary.wpm).toBeNull();
  });
});

describe('capSessions', () => {
  it('keeps the newest sessions and drops the oldest', () => {
    const sessions: SessionSummary[] = Array.from(
      { length: MAX_SESSION_SUMMARIES + 5 },
      (_, index) => ({
        ...sessionFor('a', ['a'], index).summary,
        id: `s-${String(index)}`,
      }),
    );
    const capped = capSessions(sessions);
    expect(capped).toHaveLength(MAX_SESSION_SUMMARIES);
    expect(capped[0]?.startedAt).toBe(MAX_SESSION_SUMMARIES + 4);
    expect(capped.some((session) => session.startedAt === 0)).toBe(false);
  });
});
