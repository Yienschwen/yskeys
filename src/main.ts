import './ui/styles.css';
import {
  APP_VERSION,
  GROUP_SIZE,
  MAX_IMPORT_CHARS,
  MAX_TEXTSOURCE_CHARS,
  MAX_WORDLIST_CHARS,
  MIN_USABLE_WORDS,
  RESULT_WEAK_LIMIT,
} from './config';
import { readZipDirectory, readZipEntries } from './core/archive';
import { charsFor } from './core/charset';
import { NEWLINE_KEY, applyEvent, createSession, cursorIndex, isFinished, isTypingKey } from './core/engine';
import type { Judgement, SessionEvent, SessionState } from './core/engine';
import {
  DRILL_SHAPES,
  EmptyDrillSourceError,
  buildAdaptiveDrill,
  buildUniformDrill,
  buildWordDrill,
  isWordListUsable,
  usableWords,
} from './core/generator';
import type { Drill, DrillShape } from './core/generator';
import { extractChunks, extractPastedText, extractSourceText, normalizeSourceText } from './core/sourcetext';
import type { SourceFile } from './core/sourcetext';
import {
  charsPerMinute,
  median,
  rawAccuracy,
  tallySession,
  weakestUnits,
  wordsPerMinute,
} from './core/metrics';
import { parseWordList } from './core/wordlist';
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
import {
  createSessionId,
  defaultStore,
  preferredMode,
  preferredNextKey,
  preferredShape,
  preferredSpaceDisplay,
} from './store/schema';
import type { Settings, Store, TrainingMode } from './store/schema';
import {
  loadTextSource,
  removeTextSource as removeStoredTextSource,
  saveTextSource,
} from './store/textsource';
import type { StoredTextSource } from './store/textsource';
import { buildExportFile, importFromText, parseExportFile, serializeExport } from './store/transfer';
import type { ExportTextSource, ImportMode } from './store/transfer';
import { loadWordList, removeWordList as removeStoredWordList, saveWordList } from './store/wordlist';
import type { StoredWordList } from './store/wordlist';
import { createBannerHost } from './ui/banner';
import { askImportMode, confirmClear, showExportFallback } from './ui/dialogs';
import { h } from './ui/dom';
import { createFingerDiagram } from './ui/finger-diagram';
import { formatCount, formatDuration, formatPercent, formatSpeed } from './ui/format';
import { createHistoryView } from './ui/history-view';
import type { TextSourceInfo, WordListInfo } from './ui/history-view';
import { createResultView } from './ui/result-view';
import { createSettingsControls } from './ui/settings-controls';
import type { ShapeAvailability } from './ui/settings-controls';
import { createStatRow } from './ui/stat';
import { createTypingView } from './ui/typing-view';
import type { TypingView } from './ui/typing-view';

/**
 * Wiring: app shell, keyboard translation, pause handling, view switching, and the
 * handoff between the store and the views. All typing, statistics, persistence,
 * source-extraction and word-list logic lives in src/core and src/store and is unit
 * tested; this file only connects browser events to it.
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
  wordList(): StoredWordList | null;
  importWordListText(text: string, name: string): { ok: boolean; reason?: string };
  removeWordList(): void;
  textSource(): StoredTextSource | null;
  importTextSourceFiles(files: readonly File[]): Promise<{ ok: boolean; reason?: string }>;
  importPastedText(text: string, name: string): { ok: boolean; reason?: string };
  removeTextSource(): void;
}

type Mode = 'practice' | 'result' | 'history';

export function bootstrap(root: HTMLElement, options: AppOptions = {}): AppHandle {
  const now = options.now ?? Date.now;
  const storage = resolveStorage(options.storage);
  const banner = createBannerHost();
  const stats = createStatRow(['Accuracy', 'CPM', 'Time', 'Errors']);
  const main = h('main', 'view');
  const finger = createFingerDiagram();

  // Replaced by loadInitialStore() before the first session starts.
  let store: Store = defaultStore(now());
  let wordList: StoredWordList | null = null;
  let textSource: StoredTextSource | null = null;
  let session: SessionState | null = null;
  let view: TypingView | null = null;
  let mode: Mode = 'practice';
  let activeShape: DrillShape = 'patterns';
  let activeMode: TrainingMode = 'adaptive';
  let lastJudgement: Judgement | null = null;
  let sessionCount = 0;
  let sessionWallStart = now();
  let backupKey: string | null = null;
  let warnedAboutStorage = false;

  const settingsControls = createSettingsControls(store.settings, changeSettings, {
    shapes: allShapeStates(),
  });
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
          `History was trimmed by ${formatCount(result.pruned)} of the least-practised characters to fit ` +
          'the storage budget. Export a backup if this keeps happening.',
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
    section.append(primary);
    if (preferredNextKey(store.settings)) {
      section.append(finger.element);
    }
    section.append(stats.element);
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
    finger.render(fingerChar(state));
  }

  /** The next character to press, or null when there is nothing left to hint at. */
  function fingerChar(state: SessionState): string | null {
    if (state.status === 'done' || state.status === 'aborted') {
      return null;
    }
    return state.target.charAt(cursorIndex(state));
  }

  /* --------------------------------------------------------------- sources -- */

  /**
   * Which drill shape can actually be honoured right now, and why not when it cannot.
   * One reason per shape, stated in the UI, instead of a disabled control with no
   * explanation.
   */
  function allShapeStates(): Record<DrillShape, ShapeAvailability> {
    return {
      words: wordsState(),
      text: textState(),
      patterns: { available: true, hint: '' },
    };
  }

  function wordsState(): ShapeAvailability {
    if (wordList === null) {
      return { available: false, hint: 'Import a word list in History to practise real words' };
    }
    const lettersOnly = store.settings.charsets.every(
      (id) => id === 'lowercase' || id === 'uppercase',
    );
    if (!lettersOnly) {
      return { available: false, hint: 'Real words need letter-only character sets' };
    }
    if (!isWordListUsable(wordList.words, store.settings.charsets)) {
      const usable = usableWords(wordList.words, store.settings.charsets).length;
      return {
        available: false,
        hint:
          usable === 0
            ? 'No words in your list match the enabled character sets'
            : `Only ${formatCount(usable)} usable words — at least ${formatCount(MIN_USABLE_WORDS)} are needed`,
      };
    }
    return { available: true, hint: '' };
  }

  function textState(): ShapeAvailability {
    if (textSource === null) {
      return {
        available: false,
        hint: 'Upload a repository (.zip) or text files in History to practise your own material',
      };
    }
    return { available: true, hint: '' };
  }

  function refreshShapeState(): void {
    const states = allShapeStates();
    for (const shape of DRILL_SHAPES) {
      const state = states[shape];
      settingsControls.setShapeState(shape, state.available, state.hint);
    }
  }

  /** The chunks the text shape can drill, re-extracted from the stored text. */
  function sourceChunks(): string[] {
    if (textSource === null) {
      return [];
    }
    return [...extractChunks(normalizeSourceText(textSource.text), {
      allowedChars: allowedChars(),
      keepLineBreaks: true,
    }).chunks];
  }

  function buildDrillFor(seed: number): { drill: Drill; shape: DrillShape } {
    const targetChars = store.settings.groupCount * GROUP_SIZE;
    const preferred = preferredShape(store.settings);
    const states = allShapeStates();
    // A shape that cannot be honoured falls back rather than refusing to start, but the
    // fallback is deterministic: words → text → patterns, whichever is available.
    const order: DrillShape[] = [preferred, 'words', 'text', 'patterns'];
    const shape =
      order.find((candidate) => states[candidate].available) ?? 'patterns';

    if (preferredMode(store.settings) === 'adaptive') {
      try {
        return {
          drill: buildAdaptiveDrill({
            shape,
            charsets: store.settings.charsets,
            targetChars,
            ...(shape === 'words' && wordList !== null ? { words: wordList.words } : {}),
            ...(shape === 'text' ? { textChunks: sourceChunks() } : {}),
            source: {
              unigrams: store.aggregates.unigrams,
              charsets: store.settings.charsets,
            },
            seed,
          }),
          shape,
        };
      } catch (error) {
        // An empty source falls through to the plain generators; anything else is a
        // real bug and must not be swallowed.
        if (!(error instanceof EmptyDrillSourceError)) {
          throw error;
        }
      }
    }

    if (shape === 'words' && wordList !== null) {
      try {
        return {
          drill: buildWordDrill({
            charsets: store.settings.charsets,
            targetChars,
            words: wordList.words,
            seed,
          }),
          shape: 'words',
        };
      } catch (error) {
        if (!(error instanceof EmptyDrillSourceError)) {
          throw error;
        }
      }
    }

    return {
      drill: buildUniformDrill({
        charsets: store.settings.charsets,
        groupCount: store.settings.groupCount,
        groupSize: GROUP_SIZE,
        seed,
      }),
      shape: 'patterns',
    };
  }

  function startSession(): void {
    sessionCount += 1;
    const built = buildDrillFor(nextSeed());
    activeShape = built.shape;
    activeMode = preferredMode(store.settings);
    session = createSession({ target: built.drill.text, groupSize: GROUP_SIZE });
    sessionWallStart = now();
    lastJudgement = null;
    mode = 'practice';
    view = createTypingView(built.drill, {
      spaceDisplay: preferredSpaceDisplay(store.settings),
    });
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
        mode: activeMode,
        shape: activeShape,
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
      wordList: wordListInfo(),
      textSource: textSourceInfo(),
      mode: preferredMode(store.settings),
      actions: {
        export: exportHistory,
        importFile: (file) => {
          void importFile(file);
        },
        clear: () => {
          void clearConfirmed();
        },
        undo: undoReplace,
        importWordList: (file) => {
          void importWordListFile(file);
        },
        removeWordList,
        importTextSource: (files) => {
          void importTextSourceFiles(files);
        },
        importPastedText: (text) => {
          importPastedText(text, 'Pasted text');
        },
        removeTextSource,
        setMode: (mode) => {
          changeSettings({ ...store.settings, mode });
        },
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
    return serializeExport(
      buildExportFile(store, now(), APP_VERSION, exportWordList(), exportTextSource()),
    );
  }

  function exportWordList(): { name: string; importedAt: number; words: string[] } | undefined {
    return wordList === null
      ? undefined
      : { name: wordList.name, importedAt: wordList.importedAt, words: [...wordList.words] };
  }

  function exportTextSource(): ExportTextSource | undefined {
    return textSource === null
      ? undefined
      : {
          name: textSource.name,
          importedAt: textSource.importedAt,
          text: textSource.text,
          stats: { ...textSource.stats },
        };
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

    // A file that carries a list or a text source replaces the local one; one that does
    // not leaves whatever is already imported alone.
    const incomingWordList = result.file.wordList;
    if (incomingWordList !== undefined) {
      const entry: StoredWordList = {
        name: incomingWordList.name,
        importedAt: incomingWordList.importedAt,
        words: [...incomingWordList.words],
      };
      if (storage) {
        saveWordList(storage, entry);
      }
      wordList = entry;
    }
    const incomingText = result.file.textSource;
    if (incomingText !== undefined) {
      const entry: StoredTextSource = {
        name: incomingText.name,
        importedAt: incomingText.importedAt,
        text: incomingText.text,
        stats: { ...incomingText.stats },
      };
      if (storage) {
        saveTextSource(storage, entry);
      }
      textSource = entry;
    }

    refreshShapeState();
    persist();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }

    banner.show({
      kind: 'info',
      message:
        `${importMode === 'replace' ? 'Replaced' : 'Merged'} with a file holding ` +
        `${formatCount(result.file.aggregates.totalSessions)} sessions. The file's settings are now yours.`,
      ...(backupKey === null ? {} : { action: { label: 'Undo', onClick: undoReplace } }),
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
    refreshShapeState();
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
      // Deliberately does not touch the word list or the text source: those are files
      // the user had to go and fetch, not history they can regenerate.
      clearStore(storage);
    }
    backupKey = null;
    store = defaultStore(now());
    settingsControls.update(store.settings);
    refreshShapeState();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }
    banner.show({
      kind: 'info',
      message: 'All history and settings were cleared. Your word list and text source were kept.',
    });
  }

  function changeSettings(next: Settings): void {
    store = {
      ...store,
      settings: {
        charsets: [...next.charsets],
        groupCount: next.groupCount,
        ...(next.shape === undefined ? {} : { shape: next.shape }),
        ...(next.mode === undefined ? {} : { mode: next.mode }),
        ...(next.spaceDisplay === undefined ? {} : { spaceDisplay: next.spaceDisplay }),
        ...(next.nextKey === undefined ? {} : { nextKey: next.nextKey }),
      },
    };
    settingsControls.update(store.settings);
    refreshShapeState();
    persist();
  }

  /* ----------------------------------------------------------- word list -- */

  function wordListInfo(): WordListInfo | null {
    return wordList === null
      ? null
      : {
          name: wordList.name,
          importedAt: wordList.importedAt,
          wordCount: wordList.words.length,
        };
  }

  async function importWordListFile(file: File): Promise<void> {
    if (file.size > MAX_WORDLIST_CHARS) {
      banner.show({
        kind: 'error',
        message:
          `That file is too large (${formatCount(file.size)} bytes; the limit is ` +
          `${formatCount(MAX_WORDLIST_CHARS)}). A 10k frequency list is about 100 KB.`,
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
    importWordListText(text, file.name);
  }

  function importWordListText(text: string, name: string): { ok: boolean; reason?: string } {
    const parsed = parseWordList(text);
    if (!parsed.ok) {
      banner.show({ kind: 'error', message: `Word list rejected: ${parsed.reason}` });
      return { ok: false, reason: parsed.reason };
    }

    const entry: StoredWordList = { name, importedAt: now(), words: parsed.list.words };
    if (storage) {
      const saved = saveWordList(storage, entry);
      if (!saved.ok) {
        banner.show({
          kind: 'error',
          message: `The word list could not be saved (${saved.reason ?? 'unknown error'}).`,
        });
        return { ok: false, ...(saved.reason === undefined ? {} : { reason: saved.reason }) };
      }
    }

    wordList = entry;
    refreshShapeState();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }

    const notes: string[] = [];
    if (parsed.list.skipped > 0) {
      notes.push(`${formatCount(parsed.list.skipped)} unusable lines skipped`);
    }
    if (parsed.list.duplicates > 0) {
      notes.push(`${formatCount(parsed.list.duplicates)} duplicates ignored`);
    }
    // How many of the kept words the current charsets can actually type: the parser is
    // deliberately permissive, so this is the number that matters to the user.
    const usable = usableWords(parsed.list.words, store.settings.charsets).length;
    banner.show({
      kind: 'info',
      message:
        `Imported ${formatCount(parsed.list.kept)} words from ${name}; ` +
        `${formatCount(usable)} usable with the current character sets` +
        (notes.length === 0 ? '.' : ` (${notes.join(', ')}).`),
    });
    return { ok: true };
  }

  function removeWordList(): void {
    if (storage) {
      removeStoredWordList(storage);
    }
    wordList = null;
    refreshShapeState();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }
    banner.show({
      kind: 'info',
      message: 'Word list removed. Drills fall back to the next available source.',
    });
  }

  /* --------------------------------------------------------- text source -- */

  function textSourceInfo(): TextSourceInfo | null {
    return textSource === null
      ? null
      : {
          name: textSource.name,
          importedAt: textSource.importedAt,
          chars: textSource.stats.bytes,
          files: textSource.stats.files,
          lines: textSource.stats.lines,
        };
  }

  async function importTextSourceFiles(
    files: readonly File[],
  ): Promise<{ ok: boolean; reason?: string }> {
    // `.zip` is treated as an archive only when it really is one, so a code file that
    // happens to be called something.zip is read as text alongside its siblings instead
    // of failing the whole selection.
    const archives = files.filter((file) => file.name.toLowerCase().endsWith('.zip'));
    const archive = archives.length === 1 ? archives[0] : undefined;
    if (archive !== undefined && (await isZip(archive))) {
      return importArchive(archive);
    }
    const read: SourceFile[] = [];
    for (const file of files) {
      try {
        read.push({ path: file.name, text: await file.text() });
      } catch (error) {
        banner.show({
          kind: 'error',
          message: `Could not read ${file.name}: ${describeError(error)}`,
        });
        return { ok: false };
      }
    }
    return storeSource(read, describeFiles(files), 0, false);
  }

  /** A zip starts with a local file header or an empty-archive end record: `PK`. */
  async function isZip(file: File): Promise<boolean> {
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      return head.length === 4 && head[0] === 0x50 && head[1] === 0x4b;
    } catch {
      return false;
    }
  }

  async function importArchive(file: File): Promise<{ ok: boolean; reason?: string }> {
    if (file.size > MAX_IMPORT_CHARS) {
      banner.show({
        kind: 'error',
        message: `That archive is too large to read (${formatCount(file.size)} bytes).`,
      });
      return { ok: false };
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      banner.show({
        kind: 'error',
        message: `Could not read ${file.name}: ${describeError(error)}`,
      });
      return { ok: false };
    }

    const directory = readZipDirectory(bytes);
    if (!directory.ok) {
      banner.show({ kind: 'error', message: `Archive rejected: ${directory.reason}` });
      return { ok: false, reason: directory.reason };
    }
    // Sorted so the same archive always produces the same drill material, and capped so
    // a huge repository cannot stall the tab.
    const paths = directory.entries
      .map((entry) => entry.path)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 400);
    const read = await readZipEntries(bytes, paths);
    if (read.length === 0) {
      banner.show({
        kind: 'error',
        message:
          'No readable source files were found in that archive. A .zip of the repository works; ' +
          'try uploading individual files instead.',
      });
      return { ok: false };
    }
    return storeSource(read, file.name, directory.skipped, true);
  }

  async function storeSource(
    files: readonly SourceFile[],
    name: string,
    skipped: number,
    filterPaths: boolean,
  ): Promise<{ ok: boolean; reason?: string }> {
    const extracted = extractSourceText(files, {
      allowedChars: allowedChars(),
      keepLineBreaks: true,
      maxChars: MAX_TEXTSOURCE_CHARS,
      filterPaths,
    });
    if (extracted.chunks.length === 0) {
      banner.show({
        kind: 'error',
        message:
          `Nothing in ${name} can be typed with the current character sets (${describeCharsets()}). ` +
          'Enable more sets in the header, or upload different material.',
      });
      return { ok: false };
    }
    return commitTextSource(extracted, name, skipped);
  }

  function commitTextSource(
    extracted: ReturnType<typeof extractSourceText>,
    name: string,
    archiveSkipped: number,
  ): { ok: boolean; reason?: string } {
    const skipped = extracted.stats.skipped + archiveSkipped;
    const entry: StoredTextSource = {
      name,
      importedAt: now(),
      text: extracted.text,
      stats: {
        bytes: extracted.text.length,
        files: extracted.stats.files,
        skipped,
        lines: extracted.stats.lines,
      },
    };
    if (storage) {
      const saved = saveTextSource(storage, entry);
      if (!saved.ok) {
        banner.show({
          kind: 'error',
          message: `The text source could not be saved (${saved.reason ?? 'unknown error'}).`,
        });
        return { ok: false, ...(saved.reason === undefined ? {} : { reason: saved.reason }) };
      }
    }

    textSource = entry;
    refreshShapeState();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }
    banner.show({
      kind: 'info',
      message:
        `Imported ${formatCount(entry.stats.files)} files from ${name}: ` +
        `${formatCount(entry.stats.lines)} lines, ${formatCount(entry.text.length)} characters` +
        (skipped > 0 ? ` (${formatCount(skipped)} skipped)` : '') +
        '. Choose "Text / code" in the header to drill it.',
    });
    return { ok: true };
  }

  function importPastedText(text: string, name: string): { ok: boolean; reason?: string } {
    const extracted = extractPastedText(text, {
      allowedChars: allowedChars(),
      keepLineBreaks: true,
    });
    if (extracted.chunks.length === 0) {
      banner.show({
        kind: 'error',
        message: `Nothing in that text can be typed with the current character sets (${describeCharsets()}).`,
      });
      return { ok: false };
    }
    return commitTextSource(extracted, name, 0);
  }

  function removeTextSource(): void {
    if (storage) {
      removeStoredTextSource(storage);
    }
    textSource = null;
    refreshShapeState();
    if (mode === 'history') {
      main.replaceChildren(renderHistory());
    }
    banner.show({ kind: 'info', message: 'Text source removed.' });
  }

  /** Everything the enabled character sets can produce, plus the separators. */
  function allowedChars(): ReadonlySet<string> {
    return new Set([...charsFor(store.settings.charsets), ' ', '\t']);
  }

  function describeCharsets(): string {
    return store.settings.charsets.join(', ');
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
    // Enter is a target in the text/code shape, so it can only be swallowed when the
    // drill actually expects a newline here. Everywhere else it stays a browser key.
    if (event.key === NEWLINE_KEY && state.target.charAt(cursorIndex(state)) !== '\n') {
      return;
    }
    // Tab, Shift, arrows and friends are left alone: they are not characters, and Tab
    // must keep moving focus.
    if (isTypingKey(event.key)) {
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

  /**
   * Clicking anywhere in the drill area returns focus to it (DESIGN.md §4.1), which is
   * what makes the practice view pointer-friendly without stealing focus from the
   * header's buttons.
   */
  function onClick(event: MouseEvent): void {
    if (mode !== 'practice' || !view) {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.closest('button, input, select, textarea, a, label, [data-interactive]') !== null) {
      return;
    }
    view.drill.focus();
  }

  function destroy(): void {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('click', onClick);
    root.replaceChildren();
    session = null;
    view = null;
  }

  store = loadInitialStore();
  wordList = storage === null ? null : loadWordList(storage);
  textSource = storage === null ? null : loadTextSource(storage);
  settingsControls.update(store.settings);
  refreshShapeState();
  startSession();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);
  window.addEventListener('click', onClick);

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
    wordList: () => wordList,
    importWordListText,
    removeWordList,
    textSource: () => textSource,
    importTextSourceFiles,
    importPastedText,
    removeTextSource,
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

function describeFiles(files: readonly File[]): string {
  if (files.length === 1) {
    return files[0]?.name ?? 'text';
  }
  return `${String(files.length)} files`;
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
