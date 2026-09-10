import './ui/styles.css';
import { APP_VERSION, DEFAULT_GROUP_COUNT, GROUP_SIZE, RESULT_WEAK_LIMIT } from './config';
import { CHARSETS, defaultCharsetIds } from './core/charset';
import type { CharsetId } from './core/charset';
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
import { h } from './ui/dom';
import { formatCount, formatDuration, formatPercent, formatSpeed } from './ui/format';
import { createResultView } from './ui/result-view';
import { createStatRow } from './ui/stat';
import { createTypingView } from './ui/typing-view';
import type { TypingView } from './ui/typing-view';

/**
 * Wiring: app shell, keyboard translation, pause handling and view switching.
 * All typing logic lives in src/core and is unit tested; this file only connects
 * browser events to it.
 */

export interface AppOptions {
  /** Fixes the drill sequence. Used by tests to make a session reproducible. */
  readonly seed?: number;
}

export interface AppHandle {
  newSession(): void;
  state(): SessionState;
  destroy(): void;
}

interface Settings {
  readonly charsets: readonly CharsetId[];
  readonly groupCount: number;
}

export function bootstrap(root: HTMLElement, options: AppOptions = {}): AppHandle {
  const settings: Settings = { charsets: defaultCharsetIds(), groupCount: DEFAULT_GROUP_COUNT };
  const header = buildHeader();
  const main = h('main', 'view');
  const stats = createStatRow(['Accuracy', 'CPM', 'Time', 'Errors']);

  let session: SessionState | null = null;
  let view: TypingView | null = null;
  let mode: 'practice' | 'result' = 'practice';
  let lastJudgement: Judgement | null = null;
  let sessionCount = 0;

  root.replaceChildren(header.element, main, buildFooter());

  const now = (): number => performance.now();

  function currentSession(): SessionState {
    if (!session) {
      throw new Error('no active session');
    }
    return session;
  }

  function nextSeed(): number {
    const base = options.seed === undefined ? Date.now() : options.seed;
    return (base + sessionCount * 2654435761) >>> 0;
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
      charsets: settings.charsets,
      groupCount: settings.groupCount,
      groupSize: GROUP_SIZE,
      seed: nextSeed(),
    });
    session = createSession({ target: drill.text, groupSize: GROUP_SIZE });
    lastJudgement = null;
    mode = 'practice';
    view = createTypingView(drill, GROUP_SIZE);
    main.replaceChildren(practiceSection(view.element));
    view.render(currentSession(), null);
    refresh(currentSession());
    view.drill.focus();
  }

  function step(event: SessionEvent): void {
    const result = applyEvent(currentSession(), event);
    session = result.state;
    lastJudgement = result.judgement;
    view?.render(result.state, result.judgement);
    refresh(result.state);
    if (isFinished(result.state)) {
      showResult();
    }
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
    // Focus follows the view change, so Enter replays the drill through the button
    // instead of needing a global Enter handler that could double-fire.
    element.querySelector('button')?.focus();
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
    step({ type: 'resume', at: now() });
    main.replaceChildren(practiceSection(view.element));
    view.render(currentSession(), lastJudgement);
    view.drill.focus();
  }

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
      step({ type: 'backspace', at: now() });
      return;
    }
    // Tab, Shift, arrows and friends are left alone: they are not characters, and
    // Tab must keep moving focus.
    if (event.key.length === 1) {
      event.preventDefault();
      step({ type: 'key', key: event.key, at: now(), repeat: event.repeat });
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
    step({ type: 'pause', at: now() });
    showPause();
  }

  function destroy(): void {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('blur', onBlur);
    root.replaceChildren();
    session = null;
    view = null;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);
  startSession();

  return { newSession: startSession, state: currentSession, destroy };
}

function buildHeader(): { element: HTMLElement; progress: HTMLElement } {
  const header = h('header', 'app-header');
  const inner = h('div', 'app-header__inner');
  inner.append(h('h1', 'app-title', 'yskeys'));

  const sets = h('div', 'control-row');
  sets.setAttribute('role', 'group');
  sets.setAttribute('aria-label', 'Character sets');
  for (const charset of CHARSETS) {
    const pill = h('span', charset.defaultEnabled ? 'pill is-on' : 'pill', charset.label);
    // Static until M2: rendered as disabled rather than as a control that lies.
    pill.setAttribute('aria-disabled', 'true');
    pill.title = charset.defaultEnabled
      ? `${String(charset.chars.length)} characters — in use`
      : `${String(charset.chars.length)} characters — not selectable yet`;
    sets.append(pill);
  }
  inner.append(sets);
  inner.append(
    h('span', 'hint', `${String(DEFAULT_GROUP_COUNT)} × ${String(GROUP_SIZE)} characters · lowercase`),
  );
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
  footer.append(
    h('span', '', `v${APP_VERSION} · no backend · history stays in this browser`),
  );
  return footer;
}

const autoRoot = document.getElementById('app');
if (autoRoot) {
  bootstrap(autoRoot);
}
