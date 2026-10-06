import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../config';
import { MIGRATIONS, migrateStore, peekVersion, runMigrations } from '../store/migrations';
import type { Migration } from '../store/migrations';
import { defaultStore, preferredNextKey, preferredSpaceDisplay } from '../store/schema';

function asObject(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
}

const step1: Migration = (raw) => ({ ...asObject(raw), step1: true });
const step2: Migration = (raw) => ({ ...asObject(raw), step2: true });
const chain: Readonly<Record<number, Migration>> = { 1: step1, 2: step2 };

describe('runMigrations', () => {
  it('walks a multi-step chain in order', () => {
    expect(runMigrations({ schemaVersion: 1 }, 1, 3, chain)).toEqual({
      ok: true,
      value: { schemaVersion: 1, step1: true, step2: true },
    });
  });

  it('applies exactly one step for a single-version gap', () => {
    expect(runMigrations({}, 1, 2, chain)).toEqual({ ok: true, value: { step1: true } });
  });

  it('is a no-op when the versions already match', () => {
    expect(runMigrations({ a: 1 }, 2, 2, chain)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('fails when a step is missing, naming the gap', () => {
    const result = runMigrations({}, 1, 3, { 2: step2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('no migration from v1 to v2');
    }
  });

  it('refuses to migrate downwards', () => {
    const result = runMigrations({}, 3, 1, chain);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('cannot migrate down from v3 to v1');
    }
  });
});

describe('migrateStore', () => {
  it('accepts a store at the current version', () => {
    const result = migrateStore(defaultStore(1000));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.store.sessions).toEqual([]);
      expect(result.store.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it('rejects a payload with no version, a fractional version or version 0', () => {
    expect(migrateStore({}).ok).toBe(false);
    expect(migrateStore({ schemaVersion: 1.5 }).ok).toBe(false);
    expect(migrateStore({ schemaVersion: 0 }).ok).toBe(false);
  });

  it('rejects a version from the future instead of guessing', () => {
    const result = migrateStore({ ...defaultStore(1), schemaVersion: SCHEMA_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/newer version/);
    }
  });

  it('names the malformed session and the index', () => {
    const result = migrateStore({ ...defaultStore(1), sessions: [{ id: 'x' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('sessions[0] is malformed');
    }
  });

  it('rejects malformed aggregates', () => {
    expect(migrateStore({ ...defaultStore(1), aggregates: {} }).ok).toBe(false);
    const missingKind = { ...defaultStore(1) };
    const aggregates = { ...missingKind.aggregates } as Record<string, unknown>;
    delete aggregates['byKind'];
    expect(migrateStore({ ...missingKind, aggregates }).ok).toBe(false);
  });

  it('rejects settings that could not produce a drill', () => {
    const store = defaultStore(1);
    expect(migrateStore({ ...store, settings: { charsets: [], groupCount: 30 } }).ok).toBe(false);
    expect(migrateStore({ ...store, settings: { charsets: ['bogus'], groupCount: 30 } }).ok).toBe(false);
    expect(migrateStore({ ...store, settings: { charsets: ['lowercase'], groupCount: 0 } }).ok).toBe(false);
    expect(
      migrateStore({ ...store, settings: { charsets: ['lowercase', 'lowercase'], groupCount: 30 } }).ok,
    ).toBe(false);
  });

  it('re-validates the output of a migration instead of trusting it', () => {
    const store = defaultStore(1000);
    const aggregates = { ...store.aggregates } as Record<string, unknown>;
    delete aggregates['byKind'];
    const older = { ...store, schemaVersion: 1, aggregates };

    // Without a migration, an older payload missing a dimension is rejected.
    expect(migrateStore(older, {}, 2).ok).toBe(false);

    // A migration that repairs it is accepted...
    const repair: Migration = (raw) => {
      const value = asObject(raw);
      const fixed = { ...asObject(value['aggregates']), byKind: {} };
      return { ...value, aggregates: fixed };
    };
    expect(migrateStore(older, { 1: repair }, 2).ok).toBe(true);

    // ...and one that produces nonsense is still rejected.
    const broken: Migration = () => ({ schemaVersion: 2 });
    expect(migrateStore(older, { 1: broken }, 2).ok).toBe(false);
  });

  it('ships a migration for every version below the current one', () => {
    for (let version = 1; version < SCHEMA_VERSION; version += 1) {
      expect(MIGRATIONS[version], `no migration from v${String(version)}`).toBeTypeOf('function');
    }
    expect(MIGRATIONS[SCHEMA_VERSION]).toBeUndefined();
  });

  it('drops the n-gram dimensions when migrating a v1 payload', () => {
    const v1 = {
      schemaVersion: 1,
      settings: { charsets: ['lowercase'], groupCount: 30, shape: 'uniform', mode: 'adaptive' },
      aggregates: {
        schemaVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        totalSessions: 1,
        totalKeystrokes: 5,
        unigrams: { a: { attempts: 1, firstTryCorrect: 1, wrongTyped: {} } },
        bigrams: { ab: { attempts: 1, firstTryCorrect: 1, wrongTyped: {} } },
        trigrams: { abc: { attempts: 1, firstTryCorrect: 1, wrongTyped: {} } },
        byFinger: {},
        byHand: {},
        byShifted: {},
        byKind: {},
      },
      sessions: [],
    };

    const result = migrateStore(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.store.schemaVersion).toBe(SCHEMA_VERSION);
    // The per-character history survives; the pairs and triples are gone.
    expect(result.store.aggregates.unigrams['a']?.attempts).toBe(1);
    expect(Object.keys(result.store.aggregates)).not.toContain('bigrams');
    expect(Object.keys(result.store.aggregates)).not.toContain('trigrams');
    // `uniform` was the v1 name for what v2 calls a character-group drill.
    expect(result.store.settings.shape).toBe('patterns');
  });

  it('renames the shape on v1 session summaries too, not only in settings', () => {
    // A v1 session recorded the shape that produced it, and `uniform` is not a v2 value:
    // leaving it would make the whole payload fail validation and park a real history.
    const v1Session = {
      id: 's-1',
      startedAt: 1000,
      durationMs: 1200,
      mode: 'adaptive',
      shape: 'uniform',
      charsets: ['lowercase'],
      totalChars: 4,
      attempts: 4,
      firstTryCorrect: 3,
      backspaces: 0,
      cpm: 150,
      wpm: 30,
      medianIntervalMs: 200,
      worstUnits: [{ unit: 'a', kind: 'uni', attempts: 2, errors: 1 }],
    };
    const v1 = {
      ...defaultStore(1),
      schemaVersion: 1,
      settings: { charsets: ['lowercase'], groupCount: 30, shape: 'uniform' },
      sessions: [v1Session],
    };

    const result = migrateStore(v1);
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (result.ok) {
      expect(result.store.sessions[0]?.shape).toBe('patterns');
      // The rest of the summary survives untouched.
      expect(result.store.sessions[0]?.totalChars).toBe(4);
      expect(result.store.sessions[0]?.worstUnits).toEqual([
        { unit: 'a', kind: 'uni', attempts: 2, errors: 1 },
      ]);
    }
  });

  it('reads a v1 payload with no space marker as the current default', () => {
    const v1 = {
      ...defaultStore(1),
      schemaVersion: 1,
      settings: { charsets: ['lowercase'], groupCount: 30, shape: 'uniform' },
    };
    const result = migrateStore(v1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The field is absent from the file, so the code default applies.
      expect(result.store.settings.spaceDisplay).toBeUndefined();
      expect(preferredSpaceDisplay(result.store.settings)).toBe('bar');
      expect(preferredNextKey(result.store.settings)).toBe(true);
    }
  });

  it('peeks the version without trusting the payload', () => {
    expect(peekVersion({ schemaVersion: 3 })).toBe(3);
    expect(peekVersion(null)).toBeNull();
    expect(peekVersion('nope')).toBeNull();
    expect(peekVersion({ schemaVersion: '3' })).toBeNull();
    expect(peekVersion({ schemaVersion: Number.NaN })).toBeNull();
  });
});
