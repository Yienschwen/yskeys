/**
 * Seeded randomness. The generator and the adaptive sampler (M3) both need to be
 * reproducible in tests, so nothing in `core/` may call `Math.random()` directly.
 */

export type Rng = () => number;

/**
 * mulberry32. Small, fast, and identical across engines and Node versions —
 * which is what makes "same seed, same drill" a testable promise.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, maxExclusive). Throws on a non-positive bound. */
export function randomInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt needs a positive integer bound, got ${String(maxExclusive)}`);
  }
  return Math.floor(rng() * maxExclusive);
}
