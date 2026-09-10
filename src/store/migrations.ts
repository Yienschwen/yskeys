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
 * v1 is the first stored schema, so there is nothing to migrate yet. That is exactly
 * why `runMigrations` takes the migration table as a parameter: the mechanism is
 * exercised by tests with a synthetic chain, instead of rotting until the first real
 * version bump — at which point it would be discovered broken by a user's data.
 */

/** Migrates the payload of the version in the key to the next version. */
export type Migration = (raw: unknown) => unknown;

/** Keyed by the version being migrated FROM. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

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
