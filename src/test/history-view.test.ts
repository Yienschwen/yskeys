// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOW_SAMPLE_ATTEMPTS, RESULT_WEAK_LIMIT, WEAK_TABLE_LIMIT } from '../config';
import { tallySession } from '../core/metrics';
import type { Metric } from '../core/metrics';
import { applySession, buildSessionSummary } from '../store/aggregate';
import { createSessionId, defaultSettings, defaultStore } from '../store/schema';
import type { Store } from '../store/schema';
import { createHistoryView } from '../ui/history-view';
import { playState } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

function addSession(
  store: Store,
  target: string,
  keys: readonly string[],
  startedAt: number,
  step = 400,
): Store {
  const state = playState(target, keys, { startAt: startedAt, step });
  const tally = tallySession(state);
  const summary = buildSessionSummary({
    state,
    tally,
    settings: defaultSettings(),
    id: createSessionId(startedAt, 1),
    startedAt,
    mode: 'uniform',
    shape: 'uniform',
    worstLimit: RESULT_WEAK_LIMIT,
  });
  return applySession(store, summary, tally, startedAt);
}

function storeWithSessions(): Store {
  let store = defaultStore(1000);
  store = addSession(store, 'afJ7', ['a', 'f', 'J', '7'], 2000);
  store = addSession(store, 'afJ7', ['a', 'f', 'x', '7'], 3000);
  return store;
}

function storeWithUnits(count: number): Store {
  const store = defaultStore(0);
  const unigrams: Record<string, Metric> = {};
  for (let index = 0; index < count; index += 1) {
    unigrams[String.fromCharCode(97 + index)] = {
      attempts: 1,
      firstTryCorrect: 0,
      wrongTyped: {},
    };
  }
  return {
    ...store,
    aggregates: {
      ...store.aggregates,
      unigrams,
      totalSessions: 1,
      totalKeystrokes: count,
    },
  };
}

function render(store: Store, overrides: Partial<Parameters<typeof createHistoryView>[0]> = {}) {
  const actions = {
    export: vi.fn(),
    importFile: vi.fn(),
    clear: vi.fn(),
    undo: vi.fn(),
    importWordList: vi.fn(),
    removeWordList: vi.fn(),
    setMode: vi.fn(),
  };
  const element = createHistoryView({
    store,
    actions,
    canUndo: false,
    wordList: null,
    mode: 'adaptive',
    ...overrides,
  });
  document.body.append(element);
  return { element, actions };
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`no button labelled ${text}`);
  }
  return found;
}

describe('history view', () => {
  it('shows an empty state but still offers import and export', () => {
    const { element } = render(defaultStore(0));

    expect(element.textContent).toContain('No finished sessions yet');
    expect(buttonByText(element, 'Export JSON')).toBeDefined();
    expect(element.textContent).toContain('Import JSON');
    expect(element.querySelector('table')).toBeNull();
  });

  it('reports the totals', () => {
    const { element } = render(storeWithSessions());
    const text = element.textContent ?? '';

    expect(text).toContain('Sessions');
    expect(text).toContain('Keystrokes');
    // Two sessions of four characters each.
    expect(text).toContain('8');
  });

  it('draws the CPM trend with one dot per plottable session', () => {
    const store = storeWithSessions();
    const { element } = render(store);

    const plotted = store.sessions.filter((session) => session.cpm !== null).length;
    expect(plotted).toBe(2);
    expect(element.querySelector('.chart__svg')).not.toBeNull();
    expect(element.querySelectorAll('.chart__dot')).toHaveLength(plotted);
  });

  it('omits the chart when no session recorded a speed', () => {
    // 10 ms per key is below the minimum window, so cpm is null everywhere.
    let store = defaultStore(1000);
    store = addSession(store, 'af', ['a', 'f'], 2000, 10);
    const { element } = render(store);

    expect(element.querySelector('.chart__svg')).toBeNull();
    expect(element.textContent).toContain('No finished sessions yet.');
  });

  it('flags units with too few attempts to judge', () => {
    const { element } = render(storeWithUnits(3));
    expect(element.textContent).toContain('low sample');
    expect(LOW_SAMPLE_ATTEMPTS).toBeGreaterThan(1);
  });

  it('sorts by misses by default and toggles direction when the active column is clicked again', () => {
    const { element } = render(storeWithSessions());
    const accuracyHeader = [...element.querySelectorAll('th')].find((cell) =>
      cell.textContent?.includes('Accuracy'),
    );
    expect(accuracyHeader?.getAttribute('aria-sort')).toBe('none');

    buttonByText(element, 'Accuracy').click();
    expect(accuracyHeader?.getAttribute('aria-sort')).toBe('ascending');

    buttonByText(element, 'Accuracy').click();
    expect(accuracyHeader?.getAttribute('aria-sort')).toBe('descending');
  });

  it('marks the default sort column as descending', () => {
    const { element } = render(storeWithSessions());
    const missesHeader = [...element.querySelectorAll('th')].find((cell) =>
      cell.textContent?.includes('Misses'),
    );
    expect(missesHeader?.getAttribute('aria-sort')).toBe('descending');
  });

  it('hides rows past the table limit until show-all is pressed', () => {
    const count = WEAK_TABLE_LIMIT + 5;
    const { element } = render(storeWithUnits(count));

    const firstTable = element.querySelector('table');
    expect(firstTable?.querySelectorAll('tbody tr')).toHaveLength(WEAK_TABLE_LIMIT);

    buttonByText(element, `Show all ${String(count)}`).click();
    expect(firstTable?.querySelectorAll('tbody tr')).toHaveLength(count);

    buttonByText(element, `Show top ${String(WEAK_TABLE_LIMIT)}`).click();
    expect(firstTable?.querySelectorAll('tbody tr')).toHaveLength(WEAK_TABLE_LIMIT);
  });

  it('does not offer show-all when everything already fits', () => {
    const { element } = render(storeWithSessions());
    const footer = element.querySelector('.table__footer');
    expect(footer?.hasAttribute('hidden')).toBe(true);
  });

  it('breaks accuracy down by kind, Shift and hand', () => {
    const { element } = render(storeWithSessions());
    const text = element.textContent ?? '';

    expect(text).toContain('By character kind, Shift and hand');
    expect(text).toContain('Kind');
    expect(text).toContain('Shift');
    expect(text).toContain('Hand');
    expect(text).toContain('shifted');
    expect(text).toContain('letter');
  });

  it('wires export, clear and undo to the caller', () => {
    const { element, actions } = render(storeWithSessions(), { canUndo: true });

    buttonByText(element, 'Export JSON').click();
    buttonByText(element, 'Clear all data').click();
    buttonByText(element, 'Undo replace').click();

    expect(actions.export).toHaveBeenCalledTimes(1);
    expect(actions.clear).toHaveBeenCalledTimes(1);
    expect(actions.undo).toHaveBeenCalledTimes(1);
  });

  it('offers undo only when there is something to undo', () => {
    const without = render(storeWithSessions());
    expect(without.element.textContent).not.toContain('Undo replace');

    const withUndo = render(storeWithSessions(), { canUndo: true });
    expect(withUndo.element.textContent).toContain('Undo replace');
  });

  it('accepts a chosen file and clears the input so the same file can be picked twice', () => {
    const { element, actions } = render(storeWithSessions());
    const input = element.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('no file input rendered');
    }

    Object.defineProperty(input, 'files', {
      value: [new File(['{}'], 'yskeys.json', { type: 'application/json' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));

    expect(actions.importFile).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('');
  });

  it('shows the imported word list and offers replacing or removing it', () => {
    const { element, actions } = render(storeWithSessions(), {
      wordList: {
        name: 'eff_short_wordlist_1.txt',
        importedAt: Date.UTC(2026, 0, 2),
        wordCount: 1295,
      },
    });

    expect(element.textContent).toContain('eff_short_wordlist_1.txt');
    expect(element.textContent).toContain('1295');
    expect(element.textContent).toContain('Replace word list');

    buttonByText(element, 'Remove word list').click();
    expect(actions.removeWordList).toHaveBeenCalledTimes(1);
  });

  it('invites an import when no word list is loaded', () => {
    const { element } = render(storeWithSessions());

    expect(element.textContent).toContain('No word list yet');
    expect(element.textContent).toContain('Import word list');
  });

  it('offers the weighting mode and reports a change', () => {
    const { element, actions } = render(storeWithSessions(), { mode: 'adaptive' });

    expect(element.textContent).toContain('Weighting');
    buttonByText(element, 'Uniform').click();
    expect(actions.setMode).toHaveBeenCalledWith('uniform');
  });

  it('marks the active weighting mode', () => {
    const { element } = render(storeWithSessions(), { mode: 'uniform' });
    const uniform = [...element.querySelectorAll('button.segment')].find(
      (button) => button.textContent === 'Uniform',
    );

    expect(uniform?.getAttribute('aria-pressed')).toBe('true');
    expect(uniform?.className).toContain('is-on');
  });

  it('offers the weighting mode even before any history exists', () => {
    const { element } = render(defaultStore(0));
    expect(element.textContent).toContain('Weighting');
  });
});
