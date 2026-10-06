import { SCHEMA_VERSION } from '../config';
import {
  isAggregates,
  isFiniteNumber,
  isRecord,
  isSessionSummary,
  isSettings,
} from './schema';
import type { Store } from './schema';

/**
 * Schema migrations.
 *
 * The mechanism takes the migration table as a parameter so it is exercised by tests
 * with a synthetic chain, instead of rotting until the first real version bump.
 *
 * v1 stored `bigrams` and `trigrams` alongside `unigrams`. They were removed because a
 * pair or triple re-counts the same keystroke as evidence and cannot be displayed as
 * the thing being practised, so v2 drops both maps and keeps the per-character history.
 */

/** Migrates the payload of the version in the key to the next version. */
export type Migration = (raw: unknown) => unknown;

/**
 * v1 → v2: drop the n-gram dimensions and rename the character-group shape.
 *
 * Nothing is inferred from the n-gram maps, so there is no loss to migrate across: the
 * per-character counters are untouched. The old `shape: 'uniform'` value meant "random
 * character groups", which v2 calls `patterns` — renaming it here keeps an imported v1
 * file describing the same drill.
 *
 * The rename has to happen on the session summaries too, not only in `settings`: v1
 * stamped the shape that actually produced each session, and a session whose shape the
 * validator rejects makes the whole payload unreadable — which would park a real
 * history and start the user from zero on upgrade.
 */
const upgradeToV2: Migration = (raw) => {
  if (!isRecord(raw)) {
    return raw;
  }
  const settings = raw['settings'];
  const aggregates = raw['aggregates'];
  const sessions = raw['sessions'];
  return {
    ...raw,
    schemaVersion: 2,
    ...(isRecord(settings) ? { settings: normalizeShape(settings) } : {}),
    ...(isRecord(aggregates) ? { aggregates: withoutNgramDimensions(aggregates) } : {}),
    ...(Array.isArray(sessions) ? { sessions: sessions.map(normalizeSessionShape) } : {}),
  };
};

/** `uniform` was v1's name for what v2 calls a character-group (`patterns`) drill. */
function normalizeShape(value: Record<string, unknown>): Record<string, unknown> {
  return value['shape'] === 'uniform' ? { ...value, shape: 'patterns' } : value;
}

function normalizeSessionShape(session: unknown): unknown {
  return isRecord(session) ? normalizeShape(session) : session;
}

function withoutNgramDimensions(aggregates: Record<string, unknown>): Record<string, unknown> {
  const { bigrams: _bigrams, trigrams: _trigrams, ...kept } = aggregates;
  return kept;
}

/** Keyed by the version being migrated FROM. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: upgradeToV2 };

export type MigrationResult = { ok: true; value: unknown } | { ok: false; reason: string };

export function runMigrations(
  raw: unknown,
  from: number,
  to: number,
  migrations: Readonly<Record<number, Migration>>,
): MigrationResult {
  if (from > to) {
    return { ok: false, reason: `cannot migrate down from v${String(from)} to v${String(to)}` };
  }
  let current = raw;
  for (let version = from; version < to; version += 1) {
    const migration = migrations[version];
    if (!migration) {
      return {
        ok: false,
        reason: `no migration from v${String(version)} to v${String(version + 1)}`,
      };
    }
    current = migration(current);
  }
  return { ok: true, value: current };
}

export function peekVersion(raw: unknown): number | null {
  if (!isRecord(raw)) {
    return null;
  }
  const version = raw['schemaVersion'];
  return isFiniteNumber(version) ? version : null;
}

export type StoreParse = { ok: true; store: Store } | { ok: false; reason: string };

/** Validates an already-migrated payload as a Store. */
export function toStore(migrated: unknown, schemaVersion: number = SCHEMA_VERSION): StoreParse {
  if (!isRecord(migrated)) {
    return { ok: false, reason: 'payload is not an object' };
  }
  const settings = migrated['settings'];
  if (!isSettings(settings)) {
    return { ok: false, reason: 'settings are malformed' };
  }
  const aggregates = migrated['aggregates'];
  if (!isAggregates(aggregates)) {
    return { ok: false, reason: 'aggregates are malformed' };
  }
  const sessions = migrated['sessions'];
  if (!Array.isArray(sessions)) {
    return { ok: false, reason: 'sessions is not an array' };
  }
  for (const [index, session] of sessions.entries()) {
    if (!isSessionSummary(session)) {
      return { ok: false, reason: `sessions[${String(index)}] is malformed` };
    }
  }
  return {
    ok: true,
    store: { schemaVersion, settings, aggregates, sessions },
  };
}

/**
 * Validates, migrates and re-validates a raw payload. Never throws.
 * `target` is injectable so the migration mechanism can be tested while v1 is still
 * the only real schema.
 */
export function migrateStore(
  raw: unknown,
  migrations = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): StoreParse {
  const version = peekVersion(raw);
  if (version === null) {
    return { ok: false, reason: 'missing schemaVersion' };
  }
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, reason: `unsupported schemaVersion ${String(version)}` };
  }
  if (version > target) {
    return {
      ok: false,
      reason: `written by a newer version (v${String(version)} > v${String(target)})`,
    };
  }
  if (version === target) {
    return toStore(raw, target);
  }
  const migrated = runMigrations(raw, version, target, migrations);
  if (!migrated.ok) {
    return migrated;
  }
  return toStore(migrated.value, target);
}
