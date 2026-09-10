import { applyEvent, createSession } from '../core/engine';
import type { SessionState } from '../core/engine';

/** Shared test helpers. Not a test file: vitest matches only `*.test.ts`. */

export interface PlayOptions {
  startAt?: number;
  step?: number;
}

/** Sends keys in order and returns the resulting session state. */
export function playState(
  target: string,
  keys: readonly string[],
  options: PlayOptions = {},
): SessionState {
  let state = createSession({ target, groupSize: target.length });
  let at = options.startAt ?? 1000;
  const step = options.step ?? 100;
  for (const key of keys) {
    state = applyEvent(state, { type: 'key', key, at }).state;
    at += step;
  }
  return state;
}
