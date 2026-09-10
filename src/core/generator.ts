import { charsFor } from './charset';
import type { CharsetId } from './charset';
import { createRng, randomInt } from './random';
import type { Rng } from './random';

/**
 * Drill generation. M1 only builds uniform drills; M3 adds the weighted
 * (adaptive) variant behind the same `Drill` shape.
 */

export interface SessionSpec {
  readonly charsets: readonly CharsetId[];
  readonly groupCount: number;
  readonly groupSize: number;
  readonly seed: number;
}

export interface Drill {
  /**
   * Groups are the unit of display and of line wrapping (DESIGN.md §2.3). They are
   * separated by a real space in `text`, which is typed and counted like any other
   * character — the gap between groups is not decoration.
   */
  readonly groups: readonly string[];
  readonly text: string;
}

export function buildUniformDrill(spec: SessionSpec): Drill {
  const pool = charsFor(spec.charsets);
  if (pool.length === 0) {
    throw new Error('cannot build a drill from an empty charset selection');
  }
  if (!Number.isInteger(spec.groupCount) || spec.groupCount <= 0) {
    throw new Error(`groupCount must be a positive integer, got ${String(spec.groupCount)}`);
  }
  if (!Number.isInteger(spec.groupSize) || spec.groupSize <= 0) {
    throw new Error(`groupSize must be a positive integer, got ${String(spec.groupSize)}`);
  }

  const rng = createRng(spec.seed);
  const groups: string[] = [];
  let previous = '';

  for (let groupIndex = 0; groupIndex < spec.groupCount; groupIndex += 1) {
    let group = '';
    for (let charIndex = 0; charIndex < spec.groupSize; charIndex += 1) {
      const char = pickDifferent(pool, previous, rng);
      group += char;
      previous = char;
    }
    groups.push(group);
  }

  return { groups, text: groups.join(' ') };
}

/**
 * Draws a character that differs from the previous one. With a single-character
 * pool an adjacent repeat is unavoidable, so the fallback accepts it rather than
 * looping forever.
 */
function pickDifferent(pool: string, avoid: string, rng: Rng): string {
  const maxAttempts = 16;
  let candidate = avoid;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    candidate = pool.charAt(randomInt(rng, pool.length));
    if (candidate !== avoid) {
      return candidate;
    }
  }
  return candidate;
}
