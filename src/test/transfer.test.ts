import { describe, expect, it } from 'vitest';
import { MAX_SESSION_SUMMARIES, RESULT_WEAK_LIMIT, SCHEMA_VERSION } from '../config';
import type { CharsetId } from '../core/charset';
import { tallySession } from '../core/metrics';
import { applySession, buildSessionSummary } from '../store/aggregate';
import { createSessionId, defaultSettings, defaultStore } from '../store/schema';
import type { SessionSummary, Store } from '../store/schema';
import {
  EXPORT_KIND,
  buildExportFile,
  importFromText,
  mergeStores,
  parseExportFile,
  replaceStore,
  serializeExport,
} from '../store/transfer';
import type { ExportFile, ParseResult } from '../store/transfer';
import { playState } from './helpers';

const APP_VERSION = '0.0.0';

function storeWithSession(): Store {
  const store = defaultStore(1000);
  const state = playState('afJ7', ['a', 'f', 'J', 'x'], { startAt: 2000, step: 400 });
  const tally = tallySession(state);
  const summary = buildSessionSummary({
    state,
    tally,
    settings: defaultSettings(),
    id: createSessionId(2000, 1),
    startedAt: 2000,
    mode: 'uniform',
    shape: 'uniform',
    worstLimit: RESULT_WEAK_LIMIT,
  });
  return applySession(store, summary, tally, 3000);
}

function fileOf(result: ParseResult): ExportFile {
  if (!result.ok) {
    throw new Error(`expected a successful parse, got: ${result.reason}`);
  }
  return result.file;
}

function reasonOf(result: ParseResult): string {
  return result.ok ? 'expected a failure but the parse succeeded' : result.reason;
}

function withSettings(file: ExportFile, charsets: CharsetId[], groupCount: number): ExportFile {
  return { ...file, settings: { charsets, groupCount } };
}

describe('buildExportFile', () => {
  it('matches the documented export shape', () => {
    const store = storeWithSession();
    const file = buildExportFile(store, 4000, APP_VERSION);

    expect(file.kind).toBe(EXPORT_KIND);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.exportedAt).toBe(4000);
    expect(file.app).toEqual({ version: APP_VERSION });
    expect(file.settings).toEqual(store.settings);
    expect(file.aggregates).toEqual(store.aggregates);
    expect(file.sessions).toEqual(store.sessions);
  });

  it('serializes to human-readable JSON that parses back', () => {
    const text = serializeExport(buildExportFile(storeWithSession(), 4000, APP_VERSION));
    expect(text).toContain('\n  "kind"');
    const parsed = parseExportFile(text);
    expect(parsed.ok).toBe(true);
  });
});

describe('parseExportFile', () => {
  const good = (): string => serializeExport(buildExportFile(storeWithSession(), 4000, APP_VERSION));

  it('rejects input that is not JSON of the right kind', () => {
    expect(reasonOf(parseExportFile('not json at all'))).toMatch(/not valid JSON/);
    expect(reasonOf(parseExportFile('[]'))).toMatch(/not a JSON object/);
    expect(reasonOf(parseExportFile('{}'))).toMatch(/not a yskeys export/);
    expect(
      reasonOf(parseExportFile(JSON.stringify({ kind: 'other', schemaVersion: 1 }))),
    ).toMatch(/not a yskeys export/);
  });

  it('refuses a file written by a newer version', () => {
    const file = JSON.parse(good()) as Record<string, unknown>;
    file['schemaVersion'] = SCHEMA_VERSION + 1;
    expect(reasonOf(parseExportFile(JSON.stringify(file)))).toMatch(/newer version/);
  });

  it('refuses a file with no version', () => {
    expect(reasonOf(parseExportFile(JSON.stringify({ kind: EXPORT_KIND })))).toMatch(
      /missing schemaVersion/,
    );
  });

  it('rejects malformed settings and aggregates', () => {
    const file = JSON.parse(good()) as Record<string, unknown>;
    expect(
      reasonOf(parseExportFile(JSON.stringify({ ...file, settings: { charsets: [], groupCount: 30 } }))),
    ).toBe('settings are malformed');
    expect(
      reasonOf(parseExportFile(JSON.stringify({ ...file, aggregates: { totalSessions: 1 } }))),
    ).toBe('aggregates are malformed');
  });

  it('names the offending session index', () => {
    const file = JSON.parse(good()) as Record<string, unknown>;
    const sessions = file['sessions'] as unknown[];
    const broken = { ...file, sessions: [sessions[0], { id: 'x' }] };
    expect(reasonOf(parseExportFile(JSON.stringify(broken)))).toBe('sessions[1] is malformed');
  });

  it('refuses an oversized file before parsing it', () => {
    expect(reasonOf(parseExportFile('x'.repeat(20), { maxChars: 10 }))).toMatch(/too large/);
  });

  it('refuses a nonsense version instead of trying to migrate it', () => {
    const file = JSON.parse(good()) as Record<string, unknown>;
    expect(reasonOf(parseExportFile(JSON.stringify({ ...file, schemaVersion: 0 })))).toMatch(
      /unsupported schemaVersion/,
    );
    expect(reasonOf(parseExportFile(JSON.stringify({ ...file, schemaVersion: 1.5 })))).toMatch(
      /unsupported schemaVersion/,
    );
  });

  it('rejects a sessions field that is not an array', () => {
    const file = JSON.parse(good()) as Record<string, unknown>;
    expect(reasonOf(parseExportFile(JSON.stringify({ ...file, sessions: 'none' })))).toBe(
      'sessions is not an array',
    );
  });

  it('returns the settings, aggregates and sessions it validated', () => {
    const file = fileOf(parseExportFile(good()));
    expect(file.sessions).toHaveLength(1);
    expect(file.aggregates.totalSessions).toBe(1);
    expect(file.settings.groupCount).toBe(30);
    expect(file.app.version).toBe(APP_VERSION);
  });

  it('carries an optional word list, and treats a malformed one as fatal', () => {
    const store = storeWithSession();
    const list = { name: 'eff_short_wordlist_1.txt', importedAt: 42, words: ['acid', 'acorn'] };

    const withList = fileOf(
      parseExportFile(serializeExport(buildExportFile(store, 4000, APP_VERSION, list))),
    );
    expect(withList.wordList).toEqual(list);

    const withoutList = fileOf(
      parseExportFile(serializeExport(buildExportFile(store, 4000, APP_VERSION))),
    );
    expect(withoutList.wordList).toBeUndefined();

    const raw = JSON.parse(serializeExport(buildExportFile(store, 4000, APP_VERSION))) as Record<
      string,
      unknown
    >;
    expect(reasonOf(parseExportFile(JSON.stringify({ ...raw, wordList: { name: 7 } })))).toBe(
      'wordList is malformed',
    );
  });
});

describe('round trip (PROJECT.md acceptance #4)', () => {
  it('restores every field through replace, except updatedAt', () => {
    const store = storeWithSession();
    const file = fileOf(parseExportFile(serializeExport(buildExportFile(store, 4000, APP_VERSION))));

    const restored = replaceStore(file, 9000);

    expect(restored.settings).toEqual(store.settings);
    expect(restored.sessions).toEqual(store.sessions);
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
    // updatedAt records when the local store was written, so it is the one field
    // that legitimately differs from the exported payload.
    expect(restored.aggregates).toEqual({ ...store.aggregates, updatedAt: 9000 });
  });

  it('also round-trips through the text entry point', () => {
    const store = storeWithSession();
    const result = importFromText(
      serializeExport(buildExportFile(store, 4000, APP_VERSION)),
      'replace',
      defaultStore(0),
      9000,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe('replace');
      expect(result.store.aggregates.unigrams).toEqual(store.aggregates.unigrams);
    }
  });
  it('orders sessions newest first when replacing with several', () => {
    const template = storeWithSession().sessions[0] as SessionSummary;
    const file = buildExportFile(
      {
        ...defaultStore(0),
        sessions: [
          { ...template, id: 'older', startedAt: 100 },
          { ...template, id: 'newer', startedAt: 300 },
        ],
      },
      4000,
      APP_VERSION,
    );

    expect(replaceStore(file, 1).sessions.map((session) => session.id)).toEqual([
      'newer',
      'older',
    ]);
  });
});

describe('merge (PROJECT.md acceptance #5)', () => {
  it('importing the same file twice exactly doubles the counters', () => {
    const store = storeWithSession();
    const file = buildExportFile(store, 4000, APP_VERSION);

    const once = mergeStores(defaultStore(0), file, 5000);
    const twice = mergeStores(once, file, 6000);

    expect(once.aggregates.totalSessions).toBe(store.aggregates.totalSessions);
    expect(twice.aggregates.totalSessions).toBe(store.aggregates.totalSessions * 2);
    expect(twice.aggregates.totalKeystrokes).toBe(store.aggregates.totalKeystrokes * 2);
    expect(twice.aggregates.unigrams['a']?.attempts).toBe(
      (store.aggregates.unigrams['a']?.attempts ?? 0) * 2,
    );
    expect(twice.aggregates.byFinger['l-pinky']?.attempts).toBe(
      (store.aggregates.byFinger['l-pinky']?.attempts ?? 0) * 2,
    );
  });

  it('never duplicates a session, because ids are the identity', () => {
    const store = storeWithSession();
    const file = buildExportFile(store, 4000, APP_VERSION);

    const twice = mergeStores(mergeStores(defaultStore(0), file, 5000), file, 6000);

    expect(twice.sessions).toHaveLength(store.sessions.length);
    expect(store.sessions.length).toBeGreaterThan(0);
  });

  it('keeps the earlier copy when the same id arrives with different contents', () => {
    const store = storeWithSession();
    const file = buildExportFile(store, 4000, APP_VERSION);
    const tampered: ExportFile = {
      ...file,
      sessions: file.sessions.map((session) => ({
        ...session,
        startedAt: session.startedAt + 10_000,
        attempts: 999,
      })),
    };

    const merged = mergeStores(store, tampered, 5000);

    expect(merged.sessions).toHaveLength(1);
    expect(merged.sessions[0]?.attempts).toBe(store.sessions[0]?.attempts);
  });

  it('keeps the earlier createdAt of the two stores', () => {
    const local = defaultStore(1000);
    const file = buildExportFile(defaultStore(5000), 4000, APP_VERSION);
    expect(mergeStores(local, file, 9000).aggregates.createdAt).toBe(1000);

    const later = defaultStore(9000);
    expect(mergeStores(later, file, 9500).aggregates.createdAt).toBe(5000);
  });

  it('caps the merged session list', () => {
    const template = storeWithSession().sessions[0] as SessionSummary;
    const many: SessionSummary[] = Array.from({ length: MAX_SESSION_SUMMARIES + 20 }, (_, index) => ({
      ...template,
      id: `s-many-${String(index)}`,
      startedAt: index,
    }));
    const local = { ...defaultStore(0), sessions: many };
    const file = buildExportFile({ ...defaultStore(0), sessions: many }, 4000, APP_VERSION);

    expect(mergeStores(local, file, 5000).sessions).toHaveLength(MAX_SESSION_SUMMARIES);
  });
});

describe('settings on import (decided: the file always wins)', () => {
  it('adopts the incoming settings in both replace and merge', () => {
    const file = withSettings(
      buildExportFile(storeWithSession(), 4000, APP_VERSION),
      ['digits'],
      15,
    );

    expect(replaceStore(file, 1).settings).toEqual({ charsets: ['digits'], groupCount: 15 });
    expect(mergeStores(defaultStore(0), file, 1).settings).toEqual({
      charsets: ['digits'],
      groupCount: 15,
    });
  });
});

describe('importFromText', () => {
  it('passes a failure through untouched', () => {
    const result = importFromText('nonsense', 'merge', defaultStore(0), 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not valid JSON/);
    }
  });

  it('reports which mode was applied', () => {
    const text = serializeExport(buildExportFile(storeWithSession(), 4000, APP_VERSION));
    const merged = importFromText(text, 'merge', defaultStore(0), 1);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.mode).toBe('merge');
      expect(merged.file.kind).toBe(EXPORT_KIND);
    }
  });
});
