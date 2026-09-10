import { h } from './dom';
import { DASH } from './format';

/**
 * The stat readout (DESIGN.md §3.2): label above value, tabular figures, and a
 * fixed minimum width so live updates cannot resize the row.
 */

export interface StatRow {
  readonly element: HTMLElement;
  set(label: string, value: string): void;
}

export function createStatRow(labels: readonly string[]): StatRow {
  const element = h('dl', 'stat-row');
  const values = new Map<string, HTMLElement>();

  for (const label of labels) {
    const cell = h('div', 'stat');
    const value = h('dd', 'stat__value', DASH);
    cell.append(h('dt', 'stat__label', label), value);
    values.set(label, value);
    element.append(cell);
  }

  return {
    element,
    set(label, value) {
      const node = values.get(label);
      if (!node) {
        throw new Error(`unknown stat: ${label}`);
      }
      node.textContent = value;
    },
  };
}
