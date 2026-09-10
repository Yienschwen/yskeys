import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  charStateAt,
  createSession,
  cursorIndex,
  isFinished,
} from '../core/engine';
import type { SessionState } from '../core/engine';

const TARGET = 'abcde';

function session(target = TARGET): SessionState {
  return createSession({ target, groupSize: 5 });
}

/** Sends keys in order; `step` keeps timestamps far apart from the idle threshold. */
function play(state: SessionState, keys: readonly string[], startAt = 1000, step = 100): SessionState {
  let current = state;
  let at = startAt;
  for (const key of keys) {
    current = applyEvent(current, { type: 'key', key, at }).state;
    at += step;
  }
  return current;
}

describe('createSession', () => {
  it('starts ready and empty', () => {
    const state = session();
    expect(state.status).toBe('ready');
    expect(state.typed).toBe('');
    expect(state.activeMs).toBe(0);
    expect(state.startedAt).toBeNull();
    expect(cursorIndex(state)).toBe(0);
  });

  it('refuses an empty target', () => {
    expect(() => createSession({ target: '', groupSize: 5 })).toThrow(/empty target/);
  });
});

describe('typing', () => {
  it('advances and marks a correct first attempt', () => {
    const { state, judgement } = applyEvent(session(), { type: 'key', key: 'a', at: 1000 });
    expect(judgement).toBe('correct');
    expect(state.typed).toBe('a');
    expect(state.status).toBe('running');
    expect(state.startedAt).toBe(1000);
    expect(state.firstAttempt[0]).toBe('a');
    expect(cursorIndex(state)).toBe(1);
    expect(charStateAt(state, 0)).toBe('ok');
  });

  it('advances on a wrong character and records it', () => {
    const { state, judgement } = applyEvent(session(), { type: 'key', key: 'x', at: 1000 });
    expect(judgement).toBe('wrong');
    expect(state.typed).toBe('x');
    expect(cursorIndex(state)).toBe(1);
    expect(state.firstAttempt[0]).toBe('x');
    expect(charStateAt(state, 0)).toBe('bad');
  });

  it('ignores multi-character keys such as Shift', () => {
    const ready = session();
    const result = applyEvent(ready, { type: 'key', key: 'Shift', at: 1000 });
    expect(result.judgement).toBe('ignored');
    expect(result.state).toBe(ready);
  });

  it('ignores auto-repeat', () => {
    const state = play(session(), ['a'], 1000);
    const result = applyEvent(state, { type: 'key', key: 'b', at: 1100, repeat: true });
    expect(result.judgement).toBe('ignored');
    expect(result.state).toBe(state);
  });

  it('reports an out-of-range index as untyped', () => {
    expect(charStateAt(session(), 99)).toBe('untyped');
  });
});

describe('backspace', () => {
  it('rewrites the display but never the recorded attempt', () => {
    const state = play(session(), ['a', 'x'], 1000, 100);
    const backspaced = applyEvent(state, { type: 'backspace', at: 1200 }).state;
    expect(backspaced.typed).toBe('a');
    expect(backspaced.backspaces).toBe(1);
    expect(backspaced.firstAttempt[1]).toBe('x');
    expect(backspaced.firstAttempt[0]).toBe('a');
    expect(cursorIndex(backspaced)).toBe(1);
    expect(charStateAt(backspaced, 1)).toBe('untyped');
  });

  it('marks a corrected position as fixed, not ok', () => {
    let state = play(session(), ['x'], 1000);
    state = applyEvent(state, { type: 'backspace', at: 1100 }).state;
    const retyped = applyEvent(state, { type: 'key', key: 'a', at: 1200 });
    expect(retyped.judgement).toBe('correct');
    expect(retyped.state.firstAttempt[0]).toBe('x');
    expect(charStateAt(retyped.state, 0)).toBe('fixed');
  });

  it('does nothing when there is nothing to delete', () => {
    const ready = session();
    const result = applyEvent(ready, { type: 'backspace', at: 1000 });
    expect(result.state).toBe(ready);
    expect(result.state.backspaces).toBe(0);

    const emptied = applyEvent(play(session(), ['a'], 1000), { type: 'backspace', at: 1100 })
      .state;
    expect(emptied.typed).toBe('');
    expect(emptied.backspaces).toBe(1);
    expect(applyEvent(emptied, { type: 'backspace', at: 1200 }).state.backspaces).toBe(1);
  });

  it('can back all the way out and continue', () => {
    let state = play(session(), ['a', 'b'], 1000, 100);
    state = applyEvent(state, { type: 'backspace', at: 1200 }).state;
    state = applyEvent(state, { type: 'backspace', at: 1300 }).state;
    expect(state.typed).toBe('');
    expect(state.backspaces).toBe(2);
    state = play(state, ['a', 'b'], 1400, 100);
    expect(state.typed).toBe('ab');
  });
});

describe('completion', () => {
  it('finishes when the last character is typed', () => {
    const state = play(session(), ['a', 'b', 'c', 'd', 'e'], 1000);
    expect(state.status).toBe('done');
    expect(isFinished(state)).toBe(true);
    expect(state.typed).toBe(TARGET);
  });

  it('finishes even when everything was typed wrong, because errors advance', () => {
    const state = play(session(), ['x', 'x', 'x', 'x', 'x'], 1000);
    expect(state.status).toBe('done');
  });

  it('ignores everything after finishing', () => {
    const done = play(session(), ['a', 'b', 'c', 'd', 'e'], 1000);
    expect(applyEvent(done, { type: 'key', key: 'a', at: 2000 }).state).toBe(done);
    expect(applyEvent(done, { type: 'backspace', at: 2000 }).state).toBe(done);
    expect(applyEvent(done, { type: 'abort', at: 2000 }).state).toBe(done);
  });
});

describe('pause and timing', () => {
  it('excludes paused time from activeMs', () => {
    let state = play(session(), ['a'], 1000);
    state = applyEvent(state, { type: 'pause', at: 1500 }).state;
    expect(state.status).toBe('paused');
    expect(state.activeMs).toBe(500);

    const whilePaused = applyEvent(state, { type: 'key', key: 'b', at: 9000 });
    expect(whilePaused.judgement).toBe('ignored');
    expect(whilePaused.state).toBe(state);

    state = applyEvent(state, { type: 'resume', at: 9000 }).state;
    state = applyEvent(state, { type: 'key', key: 'b', at: 9100 }).state;
    expect(state.activeMs).toBe(600);
    expect(state.typed).toBe('ab');
  });

  it('ignores pause when not running, and resume when not paused', () => {
    const ready = session();
    expect(applyEvent(ready, { type: 'pause', at: 1 }).state).toBe(ready);
    expect(applyEvent(ready, { type: 'resume', at: 1 }).state).toBe(ready);
  });

  it('does not count an idle gap toward active time or latency', () => {
    let state = play(session(), ['a'], 1000);
    state = applyEvent(state, { type: 'key', key: 'b', at: 1100 }).state;
    state = applyEvent(state, { type: 'key', key: 'c', at: 20000 }).state;
    expect(state.activeMs).toBe(100);
    expect(state.intervals).toEqual([100]);
  });

  it('samples every gap within the idle threshold', () => {
    let state = play(session(), ['a'], 1000);
    state = applyEvent(state, { type: 'key', key: 'b', at: 1100 }).state;
    state = applyEvent(state, { type: 'key', key: 'c', at: 5100 }).state;
    state = applyEvent(state, { type: 'key', key: 'd', at: 5300 }).state;
    expect(state.intervals).toEqual([100, 200]);
  });

  it('survives a non-monotonic clock instead of producing negative time', () => {
    const state = play(session(), ['a'], 1000);
    const backwards = applyEvent(state, { type: 'key', key: 'b', at: 500 }).state;
    expect(backwards.activeMs).toBe(0);
  });
});

describe('abort', () => {
  it('stops the session and ignores later keys', () => {
    const running = play(session(), ['a'], 1000);
    const aborted = applyEvent(running, { type: 'abort', at: 1100 }).state;
    expect(aborted.status).toBe('aborted');
    expect(applyEvent(aborted, { type: 'key', key: 'b', at: 1200 }).state).toBe(aborted);
  });

  it('does not turn a finished session into an aborted one', () => {
    const done = play(session(), ['a', 'b', 'c', 'd', 'e'], 1000);
    expect(applyEvent(done, { type: 'abort', at: 2000 }).state).toBe(done);
  });
});
