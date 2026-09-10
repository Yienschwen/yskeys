import {
  COLD_START_ROW_WEIGHT,
  COLD_START_SHIFTED_FACTOR,
  EXPLORATION_SHARE,
  MIN_OBSERVED_BIGRAM_ATTEMPTS,
  SAMPLE_BOOST,
  SAMPLE_BOOST_THRESHOLD,
  SESSION_UNIT_DECAY,
  UNSEEN_WEIGHT,
  WEIGHT_EXPONENT,
  WEIGHT_FLOOR,
} from '../config';
import { charsFor } from './charset';
import type { CharsetId } from './charset';
import { keyInfo } from './layout';
import { smoothedAccuracy } from './metrics';
import type { Metric } from './metrics';
import { randomInt } from './random';
import type { Rng } from './random';

/**
 * Choosing what to practise next.
 *
 * Two decisions worth stating, because both were wrong in the first draft of the spec:
 *
 *  1. There are no tiers. Drawing 60% from "the weakest 30%" and 25% from a middle tier
 *     caps the ratio between a bad unit and a good one at about 2x no matter how the
 *     weights behave, which makes the whole point of weighting unreachable. Sampling
 *     proportionally to weight encodes "how weak" directly and needs no tiers.
 *  2. The weight floor is tiny (0.01), not a real share. Not starving a unit is the job
 *     of the uniform exploration draw; a floor big enough to matter would also lift the
 *     strongest units and flatten the differences the weights are there to express.
 */

export type UnitKind = 'uni' | 'bi';

export interface Candidate {
  readonly unit: string;
  readonly kind: UnitKind;
  readonly weight: number;
  readonly attempts: number;
}

export interface AdaptiveSource {
  readonly unigrams: Readonly<Record<string, Metric>>;
  readonly bigrams: Readonly<Record<string, Metric>>;
  readonly charsets: readonly CharsetId[];
}

export interface SampleOptions {
  /** The unit drawn last time, so the same one cannot come up twice in a row. */
  readonly avoid?: string;
  /** How often each unit has already been drawn in this session. */
  readonly uses?: ReadonlyMap<string, number>;
}

export function drivableChars(charsets: readonly CharsetId[]): Set<string> {
  return new Set([...charsFor(charsets)]);
}

/**
 * Weights one measured unit. Unmeasured units never reach this function: they take
 * `UNSEEN_WEIGHT`, because the display prior would score them as strong.
 */
export function unitWeight(metric: Metric): number {
  const accuracy = smoothedAccuracy(metric);
  const base = Math.pow(1 - accuracy, WEIGHT_EXPONENT);
  const boost = metric.attempts < SAMPLE_BOOST_THRESHOLD ? SAMPLE_BOOST : 1;
  return Math.max(base * boost, WEIGHT_FLOOR);
}

export function isColdStart(source: AdaptiveSource): boolean {
  return (
    !Object.values(source.unigrams).some((metric) => metric.attempts > 0) &&
    !Object.values(source.bigrams).some((metric) => metric.attempts > 0)
  );
}

export function coldStartCandidates(
  charsets: readonly CharsetId[],
  available?: ReadonlySet<string>,
): Candidate[] {
  const list: Candidate[] = [];
  for (const char of drivableChars(charsets)) {
    if (available !== undefined && !available.has(char)) {
      continue;
    }
    const info = keyInfo(char);
    const rowWeight = COLD_START_ROW_WEIGHT[info?.row ?? 1] ?? 0.5;
    const shiftFactor = info?.shifted === true ? COLD_START_SHIFTED_FACTOR : 1;
    list.push({ unit: char, kind: 'uni', weight: rowWeight * shiftFactor, attempts: 0 });
  }
  return list;
}

export function measuredCandidates(
  source: AdaptiveSource,
  available?: ReadonlySet<string>,
): Candidate[] {
  const drivable = drivableChars(source.charsets);
  const list: Candidate[] = [];

  for (const char of drivable) {
    if (available !== undefined && !available.has(char)) {
      continue;
    }
    const metric = source.unigrams[char];
    list.push({
      unit: char,
      kind: 'uni',
      weight: metric === undefined || metric.attempts === 0 ? UNSEEN_WEIGHT : unitWeight(metric),
      attempts: metric?.attempts ?? 0,
    });
  }

  for (const [unit, metric] of Object.entries(source.bigrams)) {
    if (metric.attempts < MIN_OBSERVED_BIGRAM_ATTEMPTS) {
      continue;
    }
    if (![...unit].every((char) => drivable.has(char))) {
      continue;
    }
    if (available !== undefined && !available.has(unit)) {
      continue;
    }
    list.push({ unit, kind: 'bi', weight: unitWeight(metric), attempts: metric.attempts });
  }

  return list;
}

export function buildCandidates(
  source: AdaptiveSource,
  available?: ReadonlySet<string>,
): Candidate[] {
  return isColdStart(source)
    ? coldStartCandidates(source.charsets, available)
    : measuredCandidates(source, available);
}

export function effectiveWeight(
  candidate: Candidate,
  uses?: ReadonlyMap<string, number>,
): number {
  const used = uses?.get(candidate.unit) ?? 0;
  return candidate.weight * Math.pow(SESSION_UNIT_DECAY, used);
}

export function totalEffectiveWeight(
  pool: readonly Candidate[],
  uses?: ReadonlyMap<string, number>,
): number {
  return pool.reduce((total, candidate) => total + effectiveWeight(candidate, uses), 0);
}

/**
 * Draws one unit: 85% proportional to weight, 15% uniform. The uniform draw is what
 * guarantees a perfect unit still shows up (acceptance criterion #7).
 */
export function sampleCandidate(
  pool: readonly Candidate[],
  rng: Rng,
  options: SampleOptions = {},
): Candidate {
  const fallback = pool[0];
  if (fallback === undefined) {
    throw new Error('cannot draw from an empty candidate pool');
  }

  const withoutPrevious =
    options.avoid === undefined
      ? pool
      : pool.filter((candidate) => candidate.unit !== options.avoid);
  const from = withoutPrevious.length > 0 ? withoutPrevious : pool;

  if (rng() < EXPLORATION_SHARE) {
    return from[randomInt(rng, from.length)] ?? fallback;
  }

  const total = totalEffectiveWeight(from, options.uses);
  if (total <= 0) {
    return from[randomInt(rng, from.length)] ?? fallback;
  }

  let remaining = rng() * total;
  for (const candidate of from) {
    remaining -= effectiveWeight(candidate, options.uses);
    if (remaining <= 0) {
      return candidate;
    }
  }
  return from[from.length - 1] ?? fallback;
}

/** Convenience for tests and callers that just want the distribution. */
export function drawUnits(
  pool: readonly Candidate[],
  count: number,
  rng: Rng,
  options: SampleOptions = {},
): string[] {
  const drawn: string[] = [];
  const uses = new Map<string, number>(options.uses ?? []);
  let previous = options.avoid;
  for (let index = 0; index < count; index += 1) {
    const candidate = sampleCandidate(pool, rng, {
      ...(previous === undefined ? {} : { avoid: previous }),
      uses,
    });
    drawn.push(candidate.unit);
    uses.set(candidate.unit, (uses.get(candidate.unit) ?? 0) + 1);
    previous = candidate.unit;
  }
  return drawn;
}
