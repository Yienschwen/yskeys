import { h } from './dom';

/**
 * The CPM trend (DESIGN.md §3.5). The geometry is a pure function so the line can be
 * asserted in tests instead of being eyeballed in a browser.
 */

export interface ChartGeometry {
  /** Value for the SVG `points` attribute; empty when there is nothing to plot. */
  readonly points: string;
  readonly min: number;
  readonly max: number;
  readonly count: number;
}

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 160;
const CHART_PADDING = 10;
const SVG_NS = 'http://www.w3.org/2000/svg';

export function chartGeometry(
  values: readonly number[],
  width: number = CHART_WIDTH,
  height: number = CHART_HEIGHT,
  padding: number = CHART_PADDING,
): ChartGeometry {
  if (values.length === 0) {
    return { points: '', min: 0, max: 0, count: 0 };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const xFor = (index: number): number =>
    values.length === 1 ? width / 2 : padding + (usableWidth * index) / (values.length - 1);

  const yFor = (value: number): number => {
    // A perfectly flat series sits in the middle; pinning it to an edge would imply
    // a trend that is not there. It also avoids dividing by a zero range.
    if (max === min) {
      return height / 2;
    }
    return padding + usableHeight * (1 - (value - min) / (max - min));
  };

  const points = values
    .map((value, index) => `${round(xFor(index))},${round(yFor(value))}`)
    .join(' ');

  return { points, min, max, count: values.length };
}

export function createCpmChart(values: readonly number[], label = 'CPM'): HTMLElement {
  const wrapper = h('div', 'chart');

  if (values.length === 0) {
    wrapper.append(h('p', 'view__lead', 'No finished sessions yet.'));
    return wrapper;
  }

  const geometry = chartGeometry(values);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart__svg');
  svg.setAttribute('viewBox', `0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `${label} over the last ${String(values.length)} sessions: ${String(Math.round(first))} to ${String(Math.round(last))}, best ${String(Math.round(geometry.max))}, worst ${String(Math.round(geometry.min))}.`,
  );

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('class', 'chart__baseline');
  baseline.setAttribute('x1', '0');
  baseline.setAttribute('y1', String(CHART_HEIGHT - 1));
  baseline.setAttribute('x2', String(CHART_WIDTH));
  baseline.setAttribute('y2', String(CHART_HEIGHT - 1));
  svg.append(baseline);

  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('class', 'chart__line');
  line.setAttribute('points', geometry.points);
  svg.append(line);

  // Dots stop being information somewhere around forty sessions.
  if (values.length <= 30) {
    for (const pair of geometry.points.split(' ')) {
      const [x, y] = pair.split(',');
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'chart__dot');
      dot.setAttribute('cx', x ?? '0');
      dot.setAttribute('cy', y ?? '0');
      dot.setAttribute('r', '2.5');
      svg.append(dot);
    }
  }

  wrapper.append(svg);
  wrapper.append(hiddenTable(values, label));
  return wrapper;
}

/** Same numbers as text, for screen readers and for anyone who distrusts a line. */
function hiddenTable(values: readonly number[], label: string): HTMLElement {
  const table = h('table', 'visually-hidden');
  table.append(h('caption', '', `${label} per session, oldest first`));
  const body = h('tbody');
  values.forEach((value, index) => {
    const row = h('tr');
    row.append(h('th', '', `Session ${String(index + 1)}`));
    row.append(h('td', '', String(Math.round(value))));
    body.append(row);
  });
  table.append(body);
  return table;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
