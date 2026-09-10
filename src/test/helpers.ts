import { applyEvent, createSession } from '../core/engine';
import type { SessionState } from '../core/engine';
import type { StorageLike } from '../store/persistence';

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

/** A working storage that never touches the real localStorage. */
export class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
}

/** Storage that is present but refuses to do anything, as in a locked-down browser. */
export const UNREADABLE_STORAGE: StorageLike = {
  getItem() {
    throw new Error('SecurityError: storage is disabled');
  },
  setItem() {
    throw new Error('SecurityError: storage is disabled');
  },
  removeItem() {
    throw new Error('SecurityError: storage is disabled');
  },
  key() {
    return null;
  },
  length: 0,
};
