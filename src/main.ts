import './ui/styles.css';
import { APP_VERSION, DEFAULT_GROUP_COUNT, GROUP_SIZE, SESSION_GROUP_COUNTS } from './config';
import { CHARSETS } from './core/charset';

/**
 * M0 shell. This deliberately contains no session logic: it renders the header,
 * the design-token stylesheet, and a static sample of every drill character state
 * so the visual contract in DESIGN.md §2.3 can be eyeballed before M1 exists.
 */

type CharState = '' | 'is-ok' | 'is-bad' | 'is-fixed' | 'is-current' | 'is-pending';

const SAMPLE: ReadonlyArray<readonly [string, CharState]> = [
  ['a', 'is-ok'], ['s', 'is-ok'], ['d', 'is-ok'], ['f', 'is-bad'], ['j', 'is-fixed'],
  ['k', 'is-current'], ['l', ''], [';', ''], ['q', ''], ['w', ''],
  ['e', ''], ['r', ''], ['t', ''], ['y', ''], ['u', ''],
];

const LEGEND: ReadonlyArray<readonly [string, CharState]> = [
  ['Correct on the first attempt', 'is-ok'],
  ['Missed — first attempt was wrong', 'is-bad'],
  ['Fixed with backspace — still not counted as correct', 'is-fixed'],
  ['Current position', 'is-current'],
  ['Not yet typed', ''],
];

function h(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function renderDrillSample(): HTMLElement {
  const drill = h('div', 'drill');
  for (let start = 0; start < SAMPLE.length; start += GROUP_SIZE) {
    const group = h('span', 'group');
    if (start === 0) {
      group.classList.add('is-done');
    }
    if (start === GROUP_SIZE) {
      group.classList.add('is-active');
    }
    for (const [char, state] of SAMPLE.slice(start, start + GROUP_SIZE)) {
      group.append(h('span', state ? `ch ${state}` : 'ch', char));
    }
    drill.append(group);
  }
  return drill;
}

function renderHeader(): HTMLElement {
  const header = h('header', 'app-header');
  const inner = h('div', 'app-header__inner');

  inner.append(h('h1', 'app-title', 'yskeys'));

  const sets = h('div', 'control-row');
  sets.setAttribute('role', 'group');
  sets.setAttribute('aria-label', 'Character sets');
  for (const charset of CHARSETS) {
    const pill = h('span', charset.defaultEnabled ? 'pill is-on' : 'pill', charset.label);
    // Static in M0: the toggles become interactive in M1.
    pill.setAttribute('aria-disabled', 'true');
    pill.title = `${charset.chars.length} characters — enabled by default: ${String(charset.defaultEnabled)}`;
    sets.append(pill);
  }
  inner.append(sets);

  inner.append(
    h(
      'span',
      'hint',
      `${DEFAULT_GROUP_COUNT} × ${GROUP_SIZE} characters · ${SESSION_GROUP_COUNTS.join(' / ')} selectable`,
    ),
  );

  header.append(inner);

  const progress = h('div', 'progress');
  progress.setAttribute('aria-hidden', 'true');
  progress.append(h('div', 'progress__value'));
  header.append(progress);

  return header;
}

function renderMain(): HTMLElement {
  const main = h('main', 'view');

  main.append(h('h2', 'view__title', 'M0 — shell only'));
  main.append(
    h(
      'p',
      'view__lead',
      'The build pipeline, the design tokens and this shell are in place. Next: M1 typing engine, M2 persistence and history, M3 adaptive generation.',
    ),
  );

  const panel = h('section', 'panel');
  panel.append(h('h3', 'panel__title', 'Drill states (static sample)'));

  const drill = renderDrillSample();
  drill.setAttribute('aria-hidden', 'true');
  panel.append(drill);

  const legend = h('ul', 'legend');
  for (const [description, state] of LEGEND) {
    const item = h('li', 'legend__item');
    item.append(h('span', state ? `legend__swatch ch ${state}` : 'legend__swatch ch', 'a'));
    item.append(h('span', '', description));
    legend.append(item);
  }
  panel.append(legend);

  main.append(panel);
  return main;
}

function renderFooter(): HTMLElement {
  const footer = h('footer', 'app-footer');
  footer.append(
    h('span', '', `v${APP_VERSION} · no backend · history stays in this browser`),
  );
  return footer;
}

function mount(): void {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('#app not found');
  }
  root.append(renderHeader(), renderMain(), renderFooter());
}

mount();
