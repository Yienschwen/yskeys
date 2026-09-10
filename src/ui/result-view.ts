import type { WeakUnit } from '../core/metrics';
import { h } from './dom';
import { formatCount, formatDuration, formatMs, formatPercent, formatSpeed } from './format';
import { createStatRow } from './stat';

/** The end-of-session summary (PROJECT.md F3). */

export interface ResultModel {
  readonly accuracy: number | null;
  readonly cpm: number | null;
  readonly wpm: number | null;
  readonly durationMs: number;
  readonly backspaces: number;
  readonly medianIntervalMs: number | null;
  readonly weakest: readonly WeakUnit[];
  readonly totalChars: number;
}

export function createResultView(model: ResultModel, onAgain: () => void): HTMLElement {
  const root = h('section', 'result');
  root.append(h('h2', 'view__title', 'Session complete'));
  root.append(
    h(
      'p',
      'view__lead',
      `${String(model.totalChars)} characters. This session is not saved yet — history and export are coming.`,
    ),
  );

  const stats = createStatRow(['Accuracy', 'CPM', 'WPM', 'Time', 'Backspaces', 'Median gap']);
  stats.set('Accuracy', formatPercent(model.accuracy));
  stats.set('CPM', formatSpeed(model.cpm));
  stats.set('WPM', formatSpeed(model.wpm));
  stats.set('Time', formatDuration(model.durationMs));
  stats.set('Backspaces', formatCount(model.backspaces));
  stats.set('Median gap', formatMs(model.medianIntervalMs));
  root.append(stats.element);

  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'Missed units'));
  panel.append(createWeakTable(model.weakest));
  root.append(panel);

  const actions = h('div', 'result__actions');
  const again = h('button', 'button button--primary', 'Again');
  again.type = 'button';
  again.addEventListener('click', onAgain);
  actions.append(again);
  root.append(actions);

  return root;
}

function createWeakTable(units: readonly WeakUnit[]): HTMLElement {
  if (units.length === 0) {
    return h(
      'p',
      'view__lead',
      'Nothing was missed. Every character landed on the first attempt — try more symbols next time.',
    );
  }

  const table = h('table', 'table');
  table.append(h('caption', 'visually-hidden', 'Units missed during this session'));

  const head = h('thead');
  const headRow = h('tr');
  for (const [label, numeric] of [
    ['Unit', false],
    ['Accuracy', true],
    ['Misses', true],
    ['Samples', true],
  ] as ReadonlyArray<readonly [string, boolean]>) {
    const cell = h('th', numeric ? 'is-numeric' : '', label);
    cell.scope = 'col';
    headRow.append(cell);
  }
  head.append(headRow);

  const body = h('tbody');
  for (const unit of units) {
    const row = h('tr');
    const unitCell = h('td');
    unitCell.append(h('span', 'table__unit', unit.unit));
    if (unit.kind === 'bi') {
      unitCell.append(h('span', 'tag', 'pair'));
    }
    row.append(unitCell);
    row.append(h('td', 'is-numeric', formatPercent(unit.accuracy)));
    row.append(h('td', 'is-numeric', formatCount(unit.errors)));
    row.append(h('td', 'is-numeric', formatCount(unit.metric.attempts)));
    body.append(row);
  }

  table.append(head, body);
  return table;
}
