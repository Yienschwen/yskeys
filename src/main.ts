import './ui/styles.css';
import { APP_VERSION, GROUP_SIZE, MAX_IMPORT_CHARS, RESULT_WEAK_LIMIT } from './config';
import { applyEvent, createSession, cursorIndex, isFinished } from './core/engine';
import type { Judgement, SessionEvent, SessionState } from './core/engine';
import { buildUniformDrill } from './core/generator';
import type { Drill } from './core/generator';
import {
  charsPerMinute,
  median,
  rawAccuracy,
  tallySession,
  weakestUnits,
  wordsPerMinute,
} from './core/metrics';
import { applySession, buildSessionSummary } from './store/aggregate';
import {
  backupStore,
  clearStore,
  loadStore,
  restoreBackup,
  saveStore,
  storageAvailable,
} from './store/persistence';
import type { StorageLike } from './store/persistence';
import { createSessionId, defaultStore } from './store/schema';
import type { Settings, Store } from './store/schema';
import { buildExportFile, importFromText, parseExportFile, serializeExport } from './store/transfer';
import type { ImportMode } from './store/transfer';
import { createBannerHost } from './ui/banner';
import { askImportMode, confirmClear, showExportFallback } from './ui/dialogs';
import { h } from './ui/dom';
import { formatCount, formatDuration, formatPercent, formatSpeed } from './ui/format';
import { createHistoryView } from './ui/history-view';
import { createResultView } from './ui/result-view';
import { createSettingsControls } from './ui/settings-controls';
import { createStatRow } from './ui/stat';
import { createTypingView } from './ui/typing-view';
import type { TypingView } from './ui/typing-view';

/**
 * Wiring: app shell, keyboard translation, pause handling, view switching, and the
 * handoff between the store and the views. All typing, statistics and persistence
 * logic lives in src/core and src/store and is unit tested; this file only connects
 * browser events to it.
 */

export interface AppOptions {
  /** Fixes the drill sequence. Used by tests to make a session reproducible. */
  readonly seed?: number;
  /** Injected so tests never touch the real localStorage. */
  readonly storage?: StorageLike;
  /** Injected wall clock, for store timestamps and session ids. */
  readonly now?: () => number;
}

export interface AppHandle {
  newSession(): void;
  state(): SessionState;
  destroy(): void;
  store(): Store;
  settings(): Settings;
  changeSettings(next: Settings): void;
  showHistory(): void;
  showPractice(): void;
  exportText(): string;
  importText(text: string, mode: ImportMode): { ok: boolean; reason?: string };
  undoReplace(): boolean;
  clearAll(): void;
}

type Mode = 'practice' | 'result' | 'history';

export function bootstrap(root: HTMLElement, options: AppOptions = {}): AppHandle {
  const now = options.now ?? Date.now;
  const storage = resolveStorage(options.storage);
  const banner = createBannerHost();
  const stats = createStatRow(['Accuracy', 'CPM', 'Time', 'Errors']);
  const main = h('main', 'view');

  // Replaced by loadInitialStore() before the first session starts.
  let store: Store = defaultStore(now());
  let session: SessionState | null = null;
  let view: TypingView | null = null;
  let mode: Mode = 'practice';
  let lastJudgement: Judgement | null = null;
  let sessionCount = 0;
  let sessionWallStart = now();
  let backupKey: string | null = null;
  let warnedAboutStorage = false;

  const settingsControls = createSettingsControls(store.settings, changeSettings);
  const navButton = h('button', 'button', 'History');
  navButton.type = 'button';
  navButton.addEventListener('click', () => {
    if (mode === 'history') {
      startSession();
    } else {
      showHistory();
    }
  });

  const header = buildHeader(settingsControls.element, navButton);
  root.replaceChildren(header.element, banner.element, main, buildFooter());

  function resolveStorage(injected?: StorageLike): StorageLike | null {
    if (injected) {
      return injected;
    }
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function loadInitialStore(): Store {
    if (!storage) {
      warnPersistent(
        'This browser blocks local storage, so your history cannot be saved. Export before closing the tab.',
      );
      return defaultStore(now());
    }
    if (!storageAvailable(storage)) {
      warnPersistent(
        'Local storage is not writable, so your history cannot be saved. Export before closing the tab.',
      );
      return defaultStore(now());
    }
    const loaded = loadStore(storage, now());
    if (loaded.status === 'unavailable') {
      warnPersistent(
        `Your history could not be read (${loaded.reason ?? 'unknown error'}), so nothing will be saved.`,
      );
    } else if (loaded.status === 'corrupt') {
      banner.show({
        kind: 'warning',
        message:
          `The stored history was unreadable (${loaded.reason ?? 'unknown error'}). It has been parked ` +
          'under a separate key rather than overwritten, and yskeys is starting fresh.',
      });
    }
    return loaded.store;
  }

  function warnPersistent(message: string): void {
    banner.show({ kind: 'error', message, dismissible: false });
  }

  function persist(): void {
    if (!storage) {
      return;
    }
    const result = saveStore(storage, store);
    if (!result.ok) {
      warnedAboutStorage = true;
      warnPersistent(
        `Your history could not be saved (${result.reason ?? 'unknown error'}). Export your data to keep it.`,
      );
      return;
    }
    if (warnedAboutStorage) {
      warnedAboutStorage = false;
      banner.clear();
    }
    if (result.pruned > 0) {
      banner.show({
        kind: 'warning',
        message:
          `History was trimmed by ${formatCount(result.pruned)} of the least-practised units to fit the ` +
          'storage budget. Export a backup if this keeps happening.',
      });
    }
  }

  function currentSession(): SessionState {
    if (!session) {
      throw new Error('no active session');
    }
    return session;
  }

  function nextSeed(): number {
    const base = options.seed === undefined ? now() : options.seed;
    return (base + sessionCount * 2654435761) >>> 0;
  }

  function updateNav(): void {
    navButton.textContent = mode === 'history' ? 'Practice' : 'History';
  }

  function practiceSection(primary: HTMLElement): HTMLElement {
    const section = h('section', 'practice');
    section.append(primary, stats.element);
    return section;
  }

  function refresh(state: SessionState): void {
    const tally = tallySession(state);
    stats.set(
      'Accuracy',
      formatPercent(rawAccuracy(tally.totals.firstTryCorrect, tally.totals.attempts)),
    );
    stats.set('CPM', formatSpeed(charsPerMinute(tally.totals.firstTryCorrect, state.activeMs)));
    stats.set('Time', formatDuration(state.activeMs));
    stats.set('Errors', formatCount(tally.totals.attempts - tally.totals.firstTryCorrect));
    header.progress.style.width = `${(Math.min(1, cursorIndex(state) / state.target.length) * 100).toFixed(2)}%`;
  }

  function startSession(): void {
    sessionCount += 1;
    const drill: Drill = buildUniformDrill({
      charsets: store.settings.charsets,
      groupCount: store.settings.groupCount,
      groupSize: GROUP_SIZE,
      seed: nextSeed(),
    });
    session = createSession({ target: drill.text, groupSize: GROUP_SIZE });
    sessionWallStart = now();
    lastJudgement = null;
    mode = 'practice';
    view = createTypingView(drill, GROUP_SIZE);
    main.replaceChildren(practiceSection(view.element));
    view.render(currentSession(), null);
    refresh(currentSession());
    view.drill.focus();
    updateNav();
  }

  function step(event: SessionEvent): void {
    const result = applyEvent(currentSession(), event);
    session = result.state;
    lastJudgement = result.judgement;
    view?.render(result.state, result.judgement);
    refresh(result.state);
    if (isFinished(result.state)) {
      finishSession();
    }
  }

  function finishSession(): void {
    const state = currentSession();
    const tally = tallySession(state);
    store = applySession(
      store,
      buildSessionSummary({
        state,
        tally,
        settings: store.settings,
        id: createSessionId(sessionWallStart, sessionCount),
        startedAt: sessionWallStart,
        mode: 'uniform',
        worstLimit: RESULT_WEAK_LIMIT,
      }),
      tally,
      now(),
    );
    persist();
    showResult();
  }

  function showResult(): void {
    const state = currentSession();
    const tally = tallySession(state);
    const correct = tally.totals.firstTryCorrect;
    mode = 'result';
    const element = createResultView(
      {
        accuracy: rawAccuracy(correct, tally.totals.attempts),
        cpm: charsPerMinute(correct, state.activeMs),
        wpm: wordsPerMinute(correct, state.activeMs),
        durationMs: state.activeMs,
        backspaces: state.backspaces,
        medianIntervalMs: median(state.intervals),
        weakest: weakestUnits(tally, RESULT_WEAK_LIMIT),
        totalChars: state.target.length,
      },
      startSession,
    );
    main.replaceChildren(element);
    // Focus follows the view change, so Enter replays through the button rather than
    // through a global Enter handler that could double-fire.
    element.querySelector('button')?.focus();
    updateNav();
  }

  function showPause(): void {
    if (mode !== 'practice' || !view) {
      return;
    }
    const panel = h('section', 'pause-panel');
    panel.append(
      h('p', 'pause-panel__title', 'Paused'),
      h(
        'p',
        'pause-panel__hint',
        'The timer is stopped and anything typed now is ignored, so a stray keystroke cannot cost you accuracy.',
      ),
    );
    const resume = h('button', 'button button--primary', 'Resume');
    resume.type = 'button';
    resume.addEventListener('click', resumeSession);
    panel.append(resume);

    main.replaceChildren(practiceSection(panel));
    resume.focus();
  }

  function resumeSession(): void {
    if (mode !== 'practice' || !view) {
      return;
    }
    step({ type: 'resume', at: performance.now() });
    main.replaceChildren(practiceSection(view.element));
    view.render(currentSession(), lastJudgement);
    view.drill.focus();
  }

  /* ------------------------------------------------------------- history -- */

  function renderHistory(): HTMLElement {
    return createHistoryView({
      store,
      canUndo: backupKey !== null && storage !== null,
      actions: {
        export: exportHistory,
        importFile: (file) => {
          void importFile(file);
        },
        clear: () => {
          void clearConfirmed();
        },
        undo: undoReplace,
      },
    });
  }

  function showHistory(): void {
    if (mode === 'practice' && session && session.status === 'running') {
      // Leaving an unfinished drill abandons it, exactly as Escape does (F3).
      session = applyEvent(session, { type: 'abort', at: performance.now() }).state;
    }
    mode = 'history';
    main.replaceChildren(renderHistory());
    header.progress.style.width = '0%';
    updateNav();
  }

  function exportText(): string {
    return serializeExport(buildExportFile(store, now(), APP_VERSION));
  }

  function exportHistory(): void {
    const text = exportText();
    const filename = `yskeys-export-${timestampSlug(now())}.json`;
    if (!downloadText(filename, text)) {
      void showExportFallback(text);
    }
  }

  async function importFile(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_CHARS) {
      banner.show({
        kind: 'error',
        message: `That file is too large to import (${formatCount(file.size)} bytes).`,
      });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      banner.show({
        kind: 'error',
        message: `Could not read ${file.name}: ${describeError(error)}`,
      });
      return;
    }

    const preview = parseExportFile(text);
    if (!preview.ok) {
      banner.show({ kind: 'error', message: `Import failed: ${preview.reason}` });
      return;
    }
    const chosen = await askImportMode(preview.file);
    if (chosen !== null) {
      importText(text, chosen);
    }
  }

  function importText(text: string, importMode: ImportMode): { ok: boolean; reason?: string } {
    const result = importFromText(text, importMode, store, now());
    if (!result.ok) {
      banner.show({ kind: 'error', message: `Import failed: ${result.reason}` });
      return { ok: false, reason: result.reason };
    }

    // Snapshot before swapping the store, so Undo has something to restore.
    const previousBackup = backupKey;
    if (importMode === 'replace' && storage) {
      backupKey = backupStore(storage, store, now());
    } else {
      backupKey = previousBackup;
    }

    store = result.store;
    settingsControls.update(store.settings);
    persist();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }

    banner.show({
      kind: 'info',
      message:
        `${importMode === 'replace' ? 'Replaced' : 'Merged'} with a file holding ` +
        `${formatCount(result.file.aggregates.totalSessions)} sessions. The file's settings are now yours.`,
      ...(backupKey === null
        ? {}
        : { action: { label: 'Undo', onClick: undoReplace } }),
    });
    return { ok: true };
  }

  function undoReplace(): boolean {
    if (!storage || backupKey === null) {
      return false;
    }
    const restored = restoreBackup(storage, backupKey);
    if (!restored) {
      banner.show({ kind: 'error', message: 'The undo backup could not be read.' });
      return false;
    }
    store = restored;
    backupKey = null;
    settingsControls.update(store.settings);
    persist();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }
    banner.show({ kind: 'info', message: 'Restored the history from before the replace.' });
    return true;
  }

  async function clearConfirmed(): Promise<void> {
    const confirmed = await confirmClear(store.aggregates.totalSessions);
    if (confirmed) {
      clearAll();
    }
  }

  function clearAll(): void {
    if (storage) {
      clearStore(storage);
    }
    backupKey = null;
    store = defaultStore(now());
    settingsControls.update(store.settings);
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }
    banner.show({ kind: 'info', message: 'All history and settings were cleared.' });
  }

  function changeSettings(next: Settings): void {
    store = {
      ...store,
      settings: { charsets: [...next.charsets], groupCount: next.groupCount },
    };
    settingsControls.update(store.settings);
    persist();
  }

  /* ------------------------------------------------------------- keyboard -- */

  function onKeyDown(event: KeyboardEvent): void {
    if (mode !== 'practice') {
      return;
    }
    // Browser shortcuts must keep working (DESIGN.md §4.3). Shift stays allowed.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const state = currentSession();
    if (state.status !== 'running' && state.status !== 'ready') {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      startSession();
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      step({ type: 'backspace', at: performance.now() });
      return;
    }
    // Tab, Shift, arrows and friends are left alone: they are not characters, and Tab
    // must keep moving focus.
    if (event.key.length === 1) {
      event.preventDefault();
      step({ type: 'key', key: event.key, at: performance.now(), repeat: event.repeat });
    }
  }

  function onBlur(): void {
    if (mode !== 'practice') {
      return;
    }
    const state = currentSession();
    if (state.status !== 'running') {
      return;
    }
    step({ type: 'pause', at: performance.now() });
    showPause();
  }

  function destroy(): void {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('blur', onBlur);
    root.replaceChildren();
    session = null;
    view = null;
  }

  store = loadInitialStore();
  settingsControls.update(store.settings);
  startSession();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);

  return {
    newSession: startSession,
    state: currentSession,
    destroy,
    store: () => store,
    settings: () => store.settings,
    changeSettings,
    showHistory,
    showPractice: startSession,
    exportText,
    importText,
    undoReplace,
    clearAll,
  };
}

function buildHeader(
  settings: HTMLElement,
  nav: HTMLButtonElement,
): { element: HTMLElement; progress: HTMLElement } {
  const header = h('header', 'app-header');
  const inner = h('div', 'app-header__inner');
  inner.append(h('h1', 'app-title', 'yskeys'), settings);

  const right = h('div', 'header__actions');
  right.append(h('span', 'hint', 'Settings apply to the next drill'), nav);
  inner.append(right);
  header.append(inner);

  const progress = h('div', 'progress');
  progress.setAttribute('aria-hidden', 'true');
  const value = h('div', 'progress__value');
  progress.append(value);
  header.append(progress);

  return { element: header, progress: value };
}

function buildFooter(): HTMLElement {
  const footer = h('footer', 'app-footer');
  footer.append(h('span', '', `v${APP_VERSION} · no backend · history stays in this browser`));
  return footer;
}

function downloadText(filename: string, text: string): boolean {
  try {
    if (typeof URL.createObjectURL !== 'function') {
      return false;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = h('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

function timestampSlug(timestamp: number): string {
  const iso = new Date(timestamp).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const autoRoot = document.getElementById('app');
if (autoRoot) {
  bootstrap(autoRoot);
}
