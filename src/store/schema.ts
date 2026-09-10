import { DEFAULT_GROUP_COUNT, SCHEMA_VERSION } from '../config';
import { CHARSETS, defaultCharsetIds } from '../core/charset';
import type { CharsetId } from '../core/charset';
import type { DrillShape } from '../core/generator';
import type { Metric } from '../core/metrics';

/**
 * The persisted shapes plus the validators that decide whether an imported file may be
 * trusted. Validation lives next to the shape so the two cannot drift apart.
 */

/**
 * How units are chosen for the next drill. Orthogonal to `DrillShape`, which is the
 * *format* of the drill: `shape` says "words or character groups", `mode` says "chosen
 * by weakness or uniformly". The settings UI labels them Words/Characters and
 * Adaptive/Uniform so the two never collide in front of the user.
 */
export type TrainingMode = 'adaptive' | 'uniform';

export interface Settings {
  charsets: CharsetId[];
  groupCount: number;
  /** Optional: exports written before the word list existed must still validate. */
  shape?: DrillShape;
  /** Optional: exports written before adaptive weighting must still validate. */
  mode?: TrainingMode;
}

export function preferredShape(settings: Settings): DrillShape {
  return settings.shape ?? 'words';
}

export function preferredMode(settings: Settings): TrainingMode {
  return settings.mode ?? 'adaptive';
}

/** Metric keys that every aggregate map must have. */
export const METRIC_MAP_KEYS = [
  'unigrams',
  'bigrams',
  'trigrams',
  'byFinger',
  'byHand',
  'byShifted',
  'byKind',
] as const;

export type MetricMapKey = (typeof METRIC_MAP_KEYS)[number];

export interface Aggregates {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  totalSessions: number;
  totalKeystrokes: number;
  unigrams: Record<string, Metric>;
  bigrams: Record<string, Metric>;
  trigrams: Record<string, Metric>;
  byFinger: Record<string, Metric>;
  byHand: Record<string, Metric>;
  byShifted: Record<string, Metric>;
  byKind: Record<string, Metric>;
}

export interface WorstUnit {
  unit: string;
  kind: 'uni' | 'bi';
  attempts: number;
  errors: number;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  durationMs: number;
  mode: TrainingMode;
  /** Which drill shape produced this session; CPM is not comparable across shapes. */
  shape?: DrillShape;
  charsets: CharsetId[];
  totalChars: number;
  attempts: number;
  firstTryCorrect: number;
  backspaces: number;
  cpm: number | null;
  wpm: number | null;
  medianIntervalMs: number | null;
  worstUnits: WorstUnit[];
}

export interface Store {
  schemaVersion: number;
  settings: Settings;
  aggregates: Aggregates;
  sessions: SessionSummary[];
}

export function defaultSettings(): Settings {
  return {
    charsets: [...defaultCharsetIds()],
    groupCount: DEFAULT_GROUP_COUNT,
    shape: 'words',
    mode: 'adaptive',
  };
}

export function emptyAggregates(now: number): Aggregates {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    totalSessions: 0,
    totalKeystrokes: 0,
    unigrams: {},
    bigrams: {},
    trigrams: {},
    byFinger: {},
    byHand: {},
    byShifted: {},
    byKind: {},
  };
}

export function defaultStore(now: number): Store {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: defaultSettings(),
    aggregates: emptyAggregates(now),
    sessions: [],
  };
}

/**
 * Session ids are derived rather than random: `crypto.randomUUID` is unavailable in
 * an insecure context, and the deployed site answers on both http and https.
 */
export function createSessionId(startedAt: number, sequence: number): string {
  return `s-${startedAt.toString(36)}-${Math.max(0, Math.floor(sequence)).toString(36)}`;
}

/* ------------------------------------------------------------ validators -- */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isMetric(value: unknown): value is Metric {
  if (!isRecord(value)) {
    return false;
  }
  const attempts = value['attempts'];
  const correct = value['firstTryCorrect'];
  if (!isFiniteNumber(attempts) || !isFiniteNumber(correct) || correct > attempts) {
    return false;
  }
  const wrongTyped = value['wrongTyped'];
  return isRecord(wrongTyped) && Object.values(wrongTyped).every(isFiniteNumber);
}

export function isMetricMap(value: unknown): value is Record<string, Metric> {
  return isRecord(value) && Object.values(value).every(isMetric);
}

export function isCharsetIdArray(value: unknown): value is CharsetId[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const known = new Set<string>(CHARSETS.map((charset) => charset.id));
  return (
    value.every((id) => typeof id === 'string' && known.has(id)) &&
    new Set(value).size === value.length
  );
}

export function isSettings(value: unknown): value is Settings {
  if (!isRecord(value)) {
    return false;
  }
  const charsets = value['charsets'];
  // An empty selection cannot produce a drill, so it is malformed rather than merely empty.
  if (!isCharsetIdArray(charsets) || charsets.length === 0) {
    return false;
  }
  const groupCount = value['groupCount'];
  if (!isFiniteNumber(groupCount) || groupCount <= 0) {
    return false;
  }
  const shape = value['shape'];
  if (shape !== undefined && shape !== 'words' && shape !== 'uniform') {
    return false;
  }
  const mode = value['mode'];
  return mode === undefined || mode === 'adaptive' || mode === 'uniform';
}

export function isWorstUnit(value: unknown): value is WorstUnit {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value['unit'] !== 'string') {
    return false;
  }
  if (value['kind'] !== 'uni' && value['kind'] !== 'bi') {
    return false;
  }
  return isFiniteNumber(value['attempts']) && isFiniteNumber(value['errors']);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

export function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value)) {
    return false;
  }
  const id = value['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return false;
  }
  if (!isFiniteNumber(value['startedAt']) || !isFiniteNumber(value['durationMs'])) {
    return false;
  }
  if (value['mode'] !== 'adaptive' && value['mode'] !== 'uniform') {
    return false;
  }
  if (!isCharsetIdArray(value['charsets'])) {
    return false;
  }
  for (const key of ['totalChars', 'attempts', 'firstTryCorrect', 'backspaces'] as const) {
    if (!isFiniteNumber(value[key])) {
      return false;
    }
  }
  for (const key of ['cpm', 'wpm', 'medianIntervalMs'] as const) {
    if (!isNullableNumber(value[key])) {
      return false;
    }
  }
  const worstUnits = value['worstUnits'];
  if (!Array.isArray(worstUnits) || !worstUnits.every(isWorstUnit)) {
    return false;
  }
  const shape = value['shape'];
  return shape === undefined || shape === 'words' || shape === 'uniform';
}

export function isAggregates(value: unknown): value is Aggregates {
  if (!isRecord(value)) {
    return false;
  }
  for (const key of [
    'schemaVersion',
    'createdAt',
    'updatedAt',
    'totalSessions',
    'totalKeystrokes',
  ] as const) {
    if (!isFiniteNumber(value[key])) {
      return false;
    }
  }
  return METRIC_MAP_KEYS.every((key) => isMetricMap(value[key]));
}
