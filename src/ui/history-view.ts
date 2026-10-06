import { CHART_MAX_POINTS, LOW_SAMPLE_ATTEMPTS, WEAK_TABLE_LIMIT } from '../config';
import { FINGER_LABELS } from '../core/layout';
import type { FingerId } from '../core/layout';
import { sortUnitRows, unitRows } from '../core/metrics';
import type { Metric, SortDirection, UnitRow, UnitSortKey } from '../core/metrics';
import type { Store, TrainingMode } from '../store/schema';
import { createCpmChart } from './chart';
import { h } from './dom';
import { displayUnit, formatCount, formatPercent, formatSpeed } from './format';
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
  readonly importWordList: (file: File) => void;
  readonly removeWordList: () => void;
  /** A `.zip` of a repository, or a set of plain-text files. */
  readonly importTextSource: (files: readonly File[]) => void;
  /** A block pasted into the textarea, for the "just show me a snippet" case. */
  readonly importPastedText: (text: string) => void;
  readonly removeTextSource: () => void;
  readonly setMode: (mode: TrainingMode) => void;
}

export interface WordListInfo {
  readonly name: string;
  readonly importedAt: number;
  readonly wordCount: number;
}

export interface TextSourceInfo {
  readonly name: string;
  readonly importedAt: number;
  readonly chars: number;
  readonly files: number;
  readonly lines: number;
}

export interface HistoryInput {
  readonly store: Store;
  readonly actions: HistoryActions;
  readonly canUndo: boolean;
  readonly wordList: WordListInfo | null;
  readonly textSource: TextSourceInfo | null;
  /** Weighting mode, which lives here rather than in the header: it is a control for
   *  checking whether the adaptive part helps, not a daily setting. */
  readonly mode: TrainingMode;
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
    root.append(createModePanel(input));
    root.append(createDataPanel(input));
    return root;
  }

  root.append(createTotals(store));
  root.append(createTrend(store));
  root.append(createUnitTable('Single characters', store.aggregates.unigrams));
  root.append(createUnitTable('By finger', store.aggregates.byFinger));
  root.append(createBreakdown(store));
  root.append(createModePanel(input));
  root.append(createDataPanel(input));

  return root;
}

function createModePanel(input: HistoryInput): HTMLElement {
  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'Weighting'));
  panel.append(
    h(
      'p',
      'view__lead',
      'Adaptive spends most repetitions on the units you miss most, drawing from words that contain ' +
        'them. Uniform draws everything equally \u2014 it is the control that shows whether the ' +
        'adaptive part is doing anything at all.',
    ),
  );

  const group = h('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Weighting mode for the next drill');
  for (const [value, label] of [
    ['adaptive', 'Adaptive'],
    ['uniform', 'Uniform'],
  ] as ReadonlyArray<readonly [TrainingMode, string]>) {
    const on = value === input.mode;
    const button = h('button', on ? 'segment is-on' : 'segment', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(on));
    button.addEventListener('click', () => {
      input.actions.setMode(value);
    });
    group.append(button);
  }

  panel.append(group);
  return panel;
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
  // The finger tables hold internal ids (`l-pinky`); the label is what a human reads,
  // and the id stays available as the tooltip for anyone matching it to the layout.
  const finger = FINGER_LABELS[row.unit as FingerId];
  const label = finger ?? displayUnit(row.unit);
  const unit = h('span', 'table__unit', label);
  if (finger !== undefined) {
    unit.title = row.unit;
  } else if (label !== row.unit) {
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
  panel.append(createHistoryRow(input));
  panel.append(createWordListRow(input));
  panel.append(createTextSourceRow(input));
  panel.append(
    h(
      'p',
      'view__lead',
      'Export writes a JSON file you can reload anywhere. Nothing ever leaves this browser on its own.',
    ),
  );
  return panel;
}

function createHistoryRow(input: HistoryInput): HTMLElement {
  const row = h('div', 'data-row');
  row.append(h('h4', 'data-row__title', 'History'));

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

  row.append(actions);
  return row;
}

function createWordListRow(input: HistoryInput): HTMLElement {
  const row = h('div', 'data-row');
  row.append(h('h4', 'data-row__title', 'Word list'));

  const list = input.wordList;
  row.append(
    h(
      'p',
      'view__lead',
      list === null
        ? 'No word list yet. Real-word drills need one; the character drill works without.'
        : `${list.name} — ${formatCount(list.wordCount)} words, imported ${formatDate(list.importedAt)}.`,
    ),
  );

  const actions = h('div', 'dialog__actions');
  const fileInput = h('input', 'visually-hidden');
  fileInput.type = 'file';
  fileInput.accept = '.txt,.text,.json,text/plain';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      input.actions.importWordList(file);
    }
    fileInput.value = '';
  });
  const importLabel = h('label', 'button');
  importLabel.append(list === null ? 'Import word list' : 'Replace word list', fileInput);
  actions.append(importLabel);

  if (list !== null) {
    const remove = h('button', 'button button--danger', 'Remove word list');
    remove.type = 'button';
    remove.addEventListener('click', input.actions.removeWordList);
    actions.append(remove);
  }

  row.append(actions);
  return row;
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'at an unknown time';
  }
  return `on ${new Date(timestamp).toISOString().slice(0, 10)}`;
}

/**
 * The text / code source (PROJECT.md F14). Two doors in, because the two real cases are
 * different: a repository is one `.zip`, while "practise my own file" is one plain-text
 * file. Both are read in the browser and never uploaded anywhere.
 */
function createTextSourceRow(input: HistoryInput): HTMLElement {
  const row = h('div', 'data-row');
  row.append(h('h4', 'data-row__title', 'Text or code'));

  const source = input.textSource;
  row.append(
    h(
      'p',
      'view__lead',
      source === null
        ? 'No text source yet. Upload a repository (.zip) or any plain-text file to practise your own material line by line.'
        : `${source.name} — ${formatCount(source.chars)} characters, ` +
            `${formatCount(source.lines)} lines, ${formatCount(source.files)} files, ` +
            `imported ${formatDate(source.importedAt)}.`,
    ),
  );

  const actions = h('div', 'dialog__actions');

  const zipInput = h('input', 'visually-hidden');
  zipInput.type = 'file';
  zipInput.accept = '.zip,application/zip';
  zipInput.addEventListener('change', () => {
    const file = zipInput.files?.[0];
    if (file) {
      input.actions.importTextSource([file]);
    }
    zipInput.value = '';
  });
  const zipLabel = h('label', 'button');
  zipLabel.append('Upload repository (.zip)', zipInput);
  actions.append(zipLabel);

  const fileInput = h('input', 'visually-hidden');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.txt,.md,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.c,.h,.cpp,.css,.html,.json,.yml,.yaml,text/plain';
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    if (files.length > 0) {
      input.actions.importTextSource(files);
    }
    fileInput.value = '';
  });
  const fileLabel = h('label', 'button');
  fileLabel.append('Upload text or code files', fileInput);
  actions.append(fileLabel);

  if (source !== null) {
    const remove = h('button', 'button button--danger', 'Remove text source');
    remove.type = 'button';
    remove.addEventListener('click', input.actions.removeTextSource);
    actions.append(remove);
  }

  row.append(actions);

  // A paste box, for a snippet that is not worth saving to a file first.
  const paste = h('form', 'paste');
  const pasteLabel = h('label', 'field__label', 'Or paste code or text');
  pasteLabel.htmlFor = 'yskeys-paste';
  const textarea = h('textarea', 'textarea');
  textarea.id = 'yskeys-paste';
  textarea.rows = 4;
  textarea.placeholder = 'Paste here, then choose Import pasted text';
  const pasteButton = h('button', 'button', 'Import pasted text');
  pasteButton.type = 'submit';
  paste.append(pasteLabel, textarea, pasteButton);
  paste.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = textarea.value;
    if (text.trim().length === 0) {
      return;
    }
    textarea.value = '';
    input.actions.importPastedText(text);
  });
  row.append(paste);

  return row;
}

function sumCorrect(store: Store): number {
  return Object.values(store.aggregates.unigrams).reduce(
    (total, metric) => total + metric.firstTryCorrect,
    0,
  );
}
