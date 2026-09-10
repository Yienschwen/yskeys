import { IDLE_GAP_MS } from '../config';

/**
 * The session state machine. Pure: no DOM, no clock, no randomness. Timestamps
 * arrive on the events, so pause accounting and latency are testable without
 * fake timers.
 *
 * Attribution rules (PROJECT.md §6.1 — the part that is easy to get silently wrong):
 *   - typing a wrong character still advances the cursor (PROJECT.md D3)
 *   - the FIRST attempt at an index is the only sample that counts, forever
 *   - Backspace rewrites `typed` (the display prefix) but never `firstAttempt`
 */

export type CharState = 'untyped' | 'ok' | 'bad' | 'fixed';
export type Judgement = 'ignored' | 'correct' | 'wrong';
export type SessionStatus = 'ready' | 'running' | 'paused' | 'done' | 'aborted';

export interface SessionState {
  readonly target: string;
  readonly groupSize: number;
  /** Display prefix: everything sent so far that has not been backspaced. */
  readonly typed: string;
  /** index -> the first character ever sent for that index. */
  readonly firstAttempt: Readonly<Record<number, string>>;
  readonly backspaces: number;
  /** Time spent typing, excluding paused stretches. */
  readonly activeMs: number;
  /** Inter-keystroke gaps, capped at IDLE_GAP_MS. Display only (PROJECT.md §6.4). */
  readonly intervals: readonly number[];
  readonly status: SessionStatus;
  readonly startedAt: number | null;
  readonly lastEventAt: number | null;
}

export interface SessionConfig {
  readonly target: string;
  readonly groupSize: number;
}

export type SessionEvent =
  | { type: 'key'; key: string; at: number; repeat?: boolean }
  | { type: 'backspace'; at: number }
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number }
  | { type: 'abort'; at: number };

export interface StepResult {
  readonly state: SessionState;
  readonly judgement: Judgement;
}

export function createSession(config: SessionConfig): SessionState {
  if (config.target.length === 0) {
    throw new Error('cannot create a session with an empty target');
  }
  return {
    target: config.target,
    groupSize: config.groupSize,
    typed: '',
    firstAttempt: {},
    backspaces: 0,
    activeMs: 0,
    intervals: [],
    status: 'ready',
    startedAt: null,
    lastEventAt: null,
  };
}

export function applyEvent(state: SessionState, event: SessionEvent): StepResult {
  switch (event.type) {
    case 'key':
      return applyKey(state, event.key, event.at, event.repeat === true);
    case 'backspace':
      return applyBackspace(state, event.at);
    case 'pause':
      return applyPause(state, event.at);
    case 'resume':
      return applyResume(state, event.at);
    case 'abort':
      return applyAbort(state);
  }
}

/** Index of the next character to type. Equals the number of characters displayed. */
export function cursorIndex(state: SessionState): number {
  return state.typed.length;
}

export function charStateAt(state: SessionState, index: number): CharState {
  const expected = state.target.charAt(index);
  if (expected === '') {
    return 'untyped';
  }
  const displayed = state.typed.charAt(index);
  if (displayed === '') {
    return 'untyped';
  }
  if (displayed !== expected) {
    return 'bad';
  }
  const first = state.firstAttempt[index];
  // Corrected after a mistake: right on screen, still counted as wrong.
  return first !== undefined && first !== expected ? 'fixed' : 'ok';
}

export function isFinished(state: SessionState): boolean {
  return state.status === 'done';
}

function applyKey(
  state: SessionState,
  key: string,
  at: number,
  repeat: boolean,
): StepResult {
  if (state.status === 'done' || state.status === 'aborted' || state.status === 'paused') {
    return { state, judgement: 'ignored' };
  }
  // Auto-repeat is not a typing attempt, and multi-character keys ('Shift', 'Tab')
  // are not characters. The UI filters too; this is the backstop.
  if (repeat || key.length !== 1) {
    return { state, judgement: 'ignored' };
  }

  const index = state.typed.length;
  const expected = state.target.charAt(index);
  const correct = key === expected;
  const clock = tick(state, at);
  const typed = state.typed + key;

  return {
    state: {
      target: state.target,
      groupSize: state.groupSize,
      typed,
      firstAttempt:
        state.firstAttempt[index] === undefined
          ? { ...state.firstAttempt, [index]: key }
          : state.firstAttempt,
      backspaces: state.backspaces,
      activeMs: clock.activeMs,
      intervals: clock.interval === null ? state.intervals : [...state.intervals, clock.interval],
      status: typed.length >= state.target.length ? 'done' : 'running',
      startedAt: clock.startedAt,
      lastEventAt: clock.lastEventAt,
    },
    judgement: correct ? 'correct' : 'wrong',
  };
}

function applyBackspace(state: SessionState, at: number): StepResult {
  // Nothing to delete: not a keystroke, so it is not counted either.
  if (state.status !== 'running' || state.typed.length === 0) {
    return { state, judgement: 'ignored' };
  }
  const clock = tick(state, at);
  return {
    state: {
      ...state,
      typed: state.typed.slice(0, -1),
      backspaces: state.backspaces + 1,
      activeMs: clock.activeMs,
      lastEventAt: clock.lastEventAt,
    },
    judgement: 'ignored',
  };
}

function applyPause(state: SessionState, at: number): StepResult {
  if (state.status !== 'running') {
    return { state, judgement: 'ignored' };
  }
  const clock = tick(state, at);
  return {
    state: { ...state, activeMs: clock.activeMs, lastEventAt: clock.lastEventAt, status: 'paused' },
    judgement: 'ignored',
  };
}

/** Resuming deliberately does not count the paused stretch toward `activeMs`. */
function applyResume(state: SessionState, at: number): StepResult {
  if (state.status !== 'paused') {
    return { state, judgement: 'ignored' };
  }
  return {
    state: { ...state, status: 'running', lastEventAt: at },
    judgement: 'ignored',
  };
}

function applyAbort(state: SessionState): StepResult {
  if (state.status === 'done' || state.status === 'aborted') {
    return { state, judgement: 'ignored' };
  }
  return { state: { ...state, status: 'aborted' }, judgement: 'ignored' };
}

interface ClockTick {
  readonly activeMs: number;
  readonly startedAt: number;
  readonly lastEventAt: number;
  /** Gap since the previous event, or null when it should not be sampled. */
  readonly interval: number | null;
}

function tick(state: SessionState, at: number): ClockTick {
  if (state.status === 'ready') {
    return { activeMs: 0, startedAt: at, lastEventAt: at, interval: null };
  }
  const previous = state.lastEventAt ?? at;
  // Guard against a non-monotonic clock rather than producing negative time.
  const raw = Math.max(0, at - previous);
  // A gap beyond the idle threshold means the user stepped away, so it is neither
  // part of the typing time nor a latency sample (PROJECT.md §6.4). Without this,
  // one phone call would destroy the session's CPM.
  const idle = raw > IDLE_GAP_MS;
  return {
    activeMs: state.activeMs + (idle ? 0 : raw),
    startedAt: state.startedAt ?? at,
    lastEventAt: at,
    interval: raw > 0 && !idle ? raw : null,
  };
}
