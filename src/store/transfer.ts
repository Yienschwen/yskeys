import { MAX_IMPORT_CHARS, MAX_SESSION_SUMMARIES, SCHEMA_VERSION } from '../config';
import { mergeMetricMaps } from '../core/metrics';
import { MIGRATIONS, peekVersion, runMigrations } from './migrations';
import {
  isAggregates,
  isFiniteNumber,
  isRecord,
  isSessionSummary,
  isSettings,
} from './schema';
import type { Aggregates, SessionSummary, Settings, Store } from './schema';

/**
 * Export and import. Everything here is pure and takes text rather than a File, so
 * the whole round trip (PROJECT.md acceptance #4 and #5) is testable; the DOM file
 * picker is a thin adapter on top.
 */

export const EXPORT_KIND = 'yskeys-export';

export interface ExportFile {
  kind: typeof EXPORT_KIND;
  schemaVersion: number;
  exportedAt: number;
  app: { version: string };
  settings: Settings;
  aggregates: Aggregates;
  sessions: SessionSummary[];
}

export type ParseResult = { ok: true; file: ExportFile } | { ok: false; reason: string };
export type ImportMode = 'replace' | 'merge';
export type ImportResult =
  | { ok: true; store: Store; file: ExportFile; mode: ImportMode }
  | { ok: false; reason: string };

export function buildExportFile(store: Store, now: number, appVersion: string): ExportFile {
  return {
    kind: EXPORT_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    app: { version: appVersion },
    settings: store.settings,
    aggregates: store.aggregates,
    sessions: store.sessions,
  };
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file, null, 2);
}

export function parseExportFile(
  text: string,
  options: { maxChars?: number } = {},
): ParseResult {
  const maxChars = options.maxChars ?? MAX_IMPORT_CHARS;
  if (text.length > maxChars) {
    return { ok: false, reason: `file is too large (${String(text.length)} characters)` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'file is not a JSON object' };
  }
  const kind = parsed['kind'];
  if (kind !== EXPORT_KIND) {
    return { ok: false, reason: `not a yskeys export (kind: ${JSON.stringify(kind)})` };
  }

  const version = peekVersion(parsed);
  if (version === null) {
    return { ok: false, reason: 'missing schemaVersion' };
  }
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, reason: `unsupported schemaVersion ${String(version)}` };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `written by a newer version (v${String(version)}); update the page first`,
    };
  }

  const migrated =
    version === SCHEMA_VERSION
      ? ({ ok: true, value: parsed } as const)
      : runMigrations(parsed, version, SCHEMA_VERSION, MIGRATIONS);
  if (!migrated.ok) {
    return { ok: false, reason: migrated.reason };
  }
  const value = migrated.value;
  if (!isRecord(value)) {
    return { ok: false, reason: 'file is not a JSON object' };
  }

  const settings = value['settings'];
  if (!isSettings(settings)) {
    return { ok: false, reason: 'settings are malformed' };
  }
  const aggregates = value['aggregates'];
  if (!isAggregates(aggregates)) {
    return { ok: false, reason: 'aggregates are malformed' };
  }
  const sessions = value['sessions'];
  if (!Array.isArray(sessions)) {
    return { ok: false, reason: 'sessions is not an array' };
  }
  for (const [index, session] of sessions.entries()) {
    if (!isSessionSummary(session)) {
      return { ok: false, reason: `sessions[${String(index)}] is malformed` };
    }
  }

  const exportedAt = value['exportedAt'];
  const app = value['app'];
  return {
    ok: true,
    file: {
      kind: EXPORT_KIND,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: isFiniteNumber(exportedAt) ? exportedAt : 0,
      app:
        isRecord(app) && typeof app['version'] === 'string'
          ? { version: app['version'] }
          : { version: 'unknown' },
      settings,
      aggregates,
      sessions,
    },
  };
}

/**
 * Merge keeps every counter and unions sessions by id, so importing the same file
 * twice exactly doubles the totals without duplicating a single session.
 *
 * Settings always come from the imported file, in both modes (decided): the two modes
 * then differ only in how the numbers combine, and the file is the single source of
 * truth for what is being practised.
 */
export function mergeStores(local: Store, incoming: ExportFile, now: number): Store {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: incoming.settings,
    aggregates: {
      schemaVersion: SCHEMA_VERSION,
      createdAt: Math.min(local.aggregates.createdAt, incoming.aggregates.createdAt),
      updatedAt: now,
      totalSessions: local.aggregates.totalSessions + incoming.aggregates.totalSessions,
      totalKeystrokes: local.aggregates.totalKeystrokes + incoming.aggregates.totalKeystrokes,
      unigrams: mergeMetricMaps(local.aggregates.unigrams, incoming.aggregates.unigrams),
      bigrams: mergeMetricMaps(local.aggregates.bigrams, incoming.aggregates.bigrams),
      trigrams: mergeMetricMaps(local.aggregates.trigrams, incoming.aggregates.trigrams),
      byFinger: mergeMetricMaps(local.aggregates.byFinger, incoming.aggregates.byFinger),
      byHand: mergeMetricMaps(local.aggregates.byHand, incoming.aggregates.byHand),
      byShifted: mergeMetricMaps(local.aggregates.byShifted, incoming.aggregates.byShifted),
      byKind: mergeMetricMaps(local.aggregates.byKind, incoming.aggregates.byKind),
    },
    sessions: mergeSessions(local.sessions, incoming.sessions),
  };
}

export function replaceStore(incoming: ExportFile, now: number): Store {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: incoming.settings,
    aggregates: { ...incoming.aggregates, schemaVersion: SCHEMA_VERSION, updatedAt: now },
    sessions: [...incoming.sessions]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_SESSION_SUMMARIES),
  };
}

export function importFromText(
  text: string,
  mode: ImportMode,
  local: Store,
  now: number,
): ImportResult {
  const parsed = parseExportFile(text);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    store: mode === 'replace' ? replaceStore(parsed.file, now) : mergeStores(local, parsed.file, now),
    file: parsed.file,
    mode,
  };
}

function mergeSessions(
  a: readonly SessionSummary[],
  b: readonly SessionSummary[],
): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const session of [...a, ...b]) {
    const existing = byId.get(session.id);
    // Same id means the same session; keep the earlier copy so the result is stable.
    if (!existing || session.startedAt < existing.startedAt) {
      byId.set(session.id, session);
    }
  }
  return [...byId.values()]
    .sort((x, y) => y.startedAt - x.startedAt)
    .slice(0, MAX_SESSION_SUMMARIES);
}
