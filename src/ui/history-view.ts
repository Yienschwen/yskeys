import { CHART_MAX_POINTS, LOW_SAMPLE_ATTEMPTS, TRIGRAM_DISPLAY_MIN_ATTEMPTS, WEAK_TABLE_LIMIT } from '../config';
import { sortUnitRows, unitRows } from '../core/metrics';
import type { Metric, SortDirection, UnitRow, UnitSortKey } from '../core/metrics';
import type { Store } from '../store/schema';
import { createCpmChart } from './chart';
import { h } from './dom';
import { formatCount, displayUnit, formatPercent, formatSpeed } from './format';
import { createStatRow } from './stat';

/**
 * The history view (PROJECT.md F7): totals, the CPM trend, the weak-spot tables and
 * the data management actions. Pure rendering plus callbacks — every store change is
 * owned by main.ts, so this file never writes anything itself.
 */

export interface HistoryActions {
  readonly export: () => void;
  readonly importFile: (file: File) => void;
  readonly clear: () => void;
  readonly undo: () => void;
}

export interface HistoryInput {
  readonly store: Store;
  readonly actions: HistoryActions;
  readonly canUndo: boolean;
}

export function createHistoryView(input: HistoryInput): HTMLElement {
  const { store } = input;
  const root = h('section', 'history');

  root.append(h('h2', 'view__title', 'History'));
  root.append(
    h(
      'p',
      'view__lead',
      'Everything is counted from the first keystroke at each position, and every number here is stored only in this browser.',
    ),
  );

  if (store.aggregates.totalSessions === 0) {
    root.append(
      h(
        'p',
        'view__lead',
        'No finished sessions yet. Practise a drill, or import a file to restore an earlier history.',
      ),
    );
    root.append(createDataPanel(input));
    return root;
  }

  root.append(createTotals(store));
  root.append(createTrend(store));
  root.append(createUnitTable('Single characters', store.aggregates.unigrams));
  root.append(createUnitTable('Character pairs', store.aggregates.bigrams, { minAttempts: 2 }));
  root.append(
    createUnitTable('Character triples (3+ attempts)', store.aggregates.trigrams, {
      minAttempts: TRIGRAM_DISPLAY_MIN_ATTEMPTS,
    }),
  );
  root.append(createUnitTable('By finger', store.aggregates.byFinger));
  root.append(createBreakdown(store));
  root.append(createDataPanel(input));

  return root;
}

function createTotals(store: Store): HTMLElement {
  const stats = createStatRow([
    'Sessions',
    'Keystrokes',
    'First-try accuracy',
    'Best CPM',
    'Latest CPM',
  ]);

  const correct = sumCorrect(store);
  const keystrokes = store.aggregates.totalKeystrokes;
  const cpmValues = store.sessions
    .map((session) => session.cpm)
    .filter((value): value is number => value !== null);

  stats.set('Sessions', formatCount(store.aggregates.totalSessions));
  stats.set('Keystrokes', formatCount(keystrokes));
  stats.set(
    'First-try accuracy',
    formatPercent(keystrokes === 0 ? null : correct / keystrokes),
  );
  stats.set('Best CPM', formatSpeed(cpmValues.length === 0 ? null : Math.max(...cpmValues)));
  stats.set('Latest CPM', formatSpeed(store.sessions[0]?.cpm ?? null));

  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'Totals'));
  panel.append(stats.element);
  return panel;
}

function createTrend(store: Store): HTMLElement {
  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'Characters per minute'));
  // Sessions are stored newest first; a trend reads left to right in time.
  const values = store.sessions
    .slice(0, CHART_MAX_POINTS)
    .reverse()
    .map((session) => session.cpm)
    .filter((value): value is number => value !== null);
  panel.append(createCpmChart(values));
  return panel;
}

function createUnitTable(
  title: string,
  map: Readonly<Record<string, Metric>>,
  options: { minAttempts?: number } = {},
): HTMLElement {
  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', title));

  const all = unitRows(map).filter((row) => row.attempts >= (options.minAttempts ?? 0));
  if (all.length === 0) {
    panel.append(h('p', 'view__lead', 'Nothing recorded here yet.'));
    return panel;
  }

  let sortKey: UnitSortKey = 'errors';
  let direction: SortDirection = 'desc';
  let showAll = false;

  const table = h('table', 'table');
  table.append(h('caption', 'visually-hidden', title));
  const head = h('thead');
  const headRow = h('tr');
  const unitHead = h('th', '', 'Unit');
  unitHead.scope = 'col';
  headRow.append(unitHead);

  const columns: ReadonlyArray<readonly [UnitSortKey, string]> = [
    ['accuracy', 'Accuracy'],
    ['errors', 'Misses'],
    ['samples', 'Samples'],
  ];
  const headers = new Map<UnitSortKey, HTMLTableCellElement>();

  for (const [key, label] of columns) {
    const cell = h('th', 'is-numeric');
    cell.scope = 'col';
    const button = h('button', 'table__sort', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (sortKey === key) {
        direction = direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        // Accuracy is the only column where "worst" means the smaller number.
        direction = key === 'accuracy' ? 'asc' : 'desc';
      }
      render();
    });
    cell.append(button);
    headers.set(key, cell);
    headRow.append(cell);
  }

  const body = h('tbody');
  head.append(headRow);
  table.append(head, body);

  const footer = h('div', 'table__footer');
  const toggle = h('button', 'button button--ghost');
  toggle.type = 'button';
  toggle.addEventListener('click', () => {
    showAll = !showAll;
    render();
  });
  footer.append(toggle);

  function render(): void {
    const sorted = sortUnitRows(all, sortKey, direction);
    const shown = showAll ? sorted : sorted.slice(0, WEAK_TABLE_LIMIT);
    body.replaceChildren();
    for (const row of shown) {
      body.append(createRow(row));
    }
    for (const [key, cell] of headers) {
      cell.setAttribute(
        'aria-sort',
        sortKey === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none',
      );
    }
    toggle.textContent = showAll
      ? `Show top ${String(WEAK_TABLE_LIMIT)}`
      : `Show all ${String(sorted.length)}`;
    footer.hidden = sorted.length <= WEAK_TABLE_LIMIT;
  }

  render();
  panel.append(table, footer);
  return panel;
}

function createRow(row: UnitRow): HTMLElement {
  const tr = h('tr');
  const unitCell = h('td');
  const label = displayUnit(row.unit);
  const unit = h('span', 'table__unit', label);
  if (label !== row.unit) {
    unit.title = 'contains a space';
  }
  unitCell.append(unit);
  if (row.attempts < LOW_SAMPLE_ATTEMPTS) {
    const flag = h('span', 'tag tag--warning', 'low sample');
    flag.title = `fewer than ${String(LOW_SAMPLE_ATTEMPTS)} attempts`;
    unitCell.append(flag);
  }
  tr.append(unitCell);
  tr.append(h('td', 'is-numeric', formatPercent(row.accuracy)));
  tr.append(h('td', 'is-numeric', formatCount(row.errors)));
  tr.append(h('td', 'is-numeric', formatCount(row.attempts)));
  return tr;
}

function createBreakdown(store: Store): HTMLElement {
  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'By character kind, Shift and hand'));

  const table = h('table', 'table');
  table.append(h('caption', 'visually-hidden', 'Accuracy grouped by kind, Shift and hand'));
  const head = h('thead');
  const headRow = h('tr');
  for (const [label, numeric] of [
    ['Group', false],
    ['Value', false],
    ['Accuracy', true],
    ['Misses', true],
    ['Samples', true],
  ] as ReadonlyArray<readonly [string, boolean]>) {
    const cell = h('th', numeric ? 'is-numeric' : '', label);
    cell.scope = 'col';
    headRow.append(cell);
  }
  head.append(headRow);

  const groups: ReadonlyArray<readonly [string, Readonly<Record<string, Metric>>]> = [
    ['Kind', store.aggregates.byKind],
    ['Shift', store.aggregates.byShifted],
    ['Hand', store.aggregates.byHand],
  ];

  const body = h('tbody');
  for (const [groupName, map] of groups) {
    for (const row of sortUnitRows(unitRows(map), 'errors', 'desc')) {
      const tr = h('tr');
      tr.append(h('td', '', groupName));
      tr.append(h('td', 'table__unit', displayUnit(row.unit)));
      tr.append(h('td', 'is-numeric', formatPercent(row.accuracy)));
      tr.append(h('td', 'is-numeric', formatCount(row.errors)));
      tr.append(h('td', 'is-numeric', formatCount(row.attempts)));
      body.append(tr);
    }
  }

  table.append(head, body);
  panel.append(table);
  return panel;
}

function createDataPanel(input: HistoryInput): HTMLElement {
  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'Your data'));

  const actions = h('div', 'dialog__actions');

  const exportButton = h('button', 'button', 'Export JSON');
  exportButton.type = 'button';
  exportButton.addEventListener('click', input.actions.export);
  actions.append(exportButton);

  const fileInput = h('input', 'visually-hidden');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      input.actions.importFile(file);
    }
    // Allows choosing the same file twice in a row.
    fileInput.value = '';
  });
  const importLabel = h('label', 'button');
  importLabel.append('Import JSON', fileInput);
  actions.append(importLabel);

  if (input.canUndo) {
    const undo = h('button', 'button', 'Undo replace');
    undo.type = 'button';
    undo.addEventListener('click', input.actions.undo);
    actions.append(undo);
  }

  const clear = h('button', 'button button--danger', 'Clear all data');
  clear.type = 'button';
  clear.addEventListener('click', input.actions.clear);
  actions.append(clear);

  panel.append(actions);
  panel.append(
    h(
      'p',
      'view__lead',
      'Export writes a JSON file you can reload anywhere. Nothing ever leaves this browser on its own.',
    ),
  );
  return panel;
}

function sumCorrect(store: Store): number {
  return Object.values(store.aggregates.unigrams).reduce(
    (total, metric) => total + metric.firstTryCorrect,
    0,
  );
}
