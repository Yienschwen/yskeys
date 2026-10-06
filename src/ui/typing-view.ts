import { charStateAt, cursorIndex } from '../core/engine';
import type { CharState, Judgement, SessionState } from '../core/engine';
import type { Drill } from '../core/generator';
import { isSpaceDisplay } from '../store/schema';
import type { SpaceDisplay } from '../store/schema';
import { h } from './dom';

/**
 * Renders one drill. Every character gets a fixed-width span whose class changes in
 * place, so no state change can reflow the line (DESIGN.md §2.3).
 *
 * In the words and patterns shapes the chunks are separated by a real space character,
 * not by decoration: the space is a target the user has to type, and its span draws a
 * marker because an empty box would be invisible. Which marker is a user setting
 * (`spaceDisplay` on the drill element); all four are pure CSS on the same fixed-width
 * span, so switching never reflows the drill.
 *
 * In the text shape a newline is a target of its own and it *ends a visual line*, which
 * is the whole point of practising code. Its span is a zero-width marker followed by a
 * `flex-basis: 100%` break, so the code keeps its shape without any width arithmetic
 * depending on the marker style.
 */

const STATE_CLASS: Record<CharState, string> = {
  untyped: '',
  ok: 'is-ok',
  bad: 'is-bad',
  fixed: 'is-fixed',
};

let viewCounter = 0;

export interface TypingView {
  readonly element: HTMLElement;
  readonly drill: HTMLElement;
  render(state: SessionState, judgement: Judgement | null): void;
}

export interface TypingViewOptions {
  readonly spaceDisplay?: SpaceDisplay;
}

/** The three kinds of target a drill can contain. */
type CharKind = 'char' | 'space' | 'newline';

export function createTypingView(drill: Drill, options: TypingViewOptions = {}): TypingView {
  viewCounter += 1;
  const statusId = `drill-status-${String(viewCounter)}`;
  const spaceDisplay =
    options.spaceDisplay !== undefined && isSpaceDisplay(options.spaceDisplay)
      ? options.spaceDisplay
      : 'bar';

  const element = h('div', 'typing');
  const drillElement = h('div', 'drill');
  drillElement.dataset['space'] = spaceDisplay;
  drillElement.setAttribute('role', 'application');
  drillElement.setAttribute(
    'aria-label',
    'Typing drill. Type the characters shown, including the spaces between the groups. Escape starts a new drill.',
  );
  drillElement.tabIndex = 0;

  const status = h('p', 'visually-hidden');
  status.id = statusId;
  status.setAttribute('aria-live', 'polite');
  drillElement.setAttribute('aria-describedby', statusId);

  const charElements: HTMLElement[] = [];
  const charKinds: CharKind[] = [];
  const groupElements: HTMLElement[] = [];
  const groupRanges: Array<{ start: number; end: number }> = [];
  const separator = drill.separator;

  let offset = 0;
  let groupElement: HTMLElement | null = null;
  let groupStart = 0;

  const closeGroup = (): void => {
    if (groupElement === null) {
      return;
    }
    groupElements.push(groupElement);
    groupRanges.push({ start: groupStart, end: offset });
    groupElement = null;
  };

  drill.groups.forEach((chunk, chunkIndex) => {
    if (chunkIndex > 0 && separator.length > 0) {
      // The separator is a real target: in the words and patterns shapes it is the
      // space between chunks, and the user has to type it.
      closeGroup();
      for (const char of separator) {
        const separatorElement = h('span', 'ch ch--space', char);
        charElements.push(separatorElement);
        charKinds.push('space');
        drillElement.append(separatorElement);
        offset += 1;
      }
    }

    if (chunk === '\n') {
      closeGroup();
      const breakElement = h('span', 'ch ch--newline');
      charElements.push(breakElement);
      charKinds.push('newline');
      drillElement.append(breakElement);
      offset += 1;
      return;
    }

    if (groupElement === null) {
      groupElement = h('span', 'group');
      groupStart = offset;
    }
    for (const char of chunk) {
      const charElement = h('span', 'ch', char);
      charElements.push(charElement);
      charKinds.push('char');
      groupElement.append(charElement);
      offset += 1;
    }
    drillElement.append(groupElement);
  });
  closeGroup();

  // The group list is built in target order, so its ranges line up with the character
  // spans even when a line break sits between two groups.
  if (groupElements.length !== groupRanges.length) {
    throw new Error('drill rendering lost a group');
  }

  element.append(drillElement, status);

  let previousStates: CharState[] = [];
  let previousCurrent: boolean[] = [];
  let previousPending = false;
  let previousGroupKey = '';

  function groupIndexFor(cursor: number): number {
    for (let index = 0; index < groupRanges.length; index += 1) {
      const range = groupRanges[index];
      if (range !== undefined && cursor < range.end) {
        return index;
      }
    }
    return Math.max(0, groupRanges.length - 1);
  }

  function render(state: SessionState, judgement: Judgement | null): void {
    const cursor = cursorIndex(state);
    // "Upcoming" styling applies before the first key and while paused.
    const pending = state.status === 'ready' || state.status === 'paused';
    const forceAll = pending !== previousPending;
    previousPending = pending;

    for (let index = 0; index < charElements.length; index += 1) {
      const charElement = charElements[index];
      if (!charElement) {
        continue;
      }
      const charState = charStateAt(state, index);
      const isCurrent = index === cursor;
      if (forceAll || previousStates[index] !== charState || previousCurrent[index] !== isCurrent) {
        charElement.className = classFor(
          charState,
          isCurrent,
          pending,
          charKinds[index] ?? 'char',
        );
        previousStates[index] = charState;
        previousCurrent[index] = isCurrent;
      }
    }

    const activeGroup = groupIndexFor(cursor);
    const groupKey = `${String(activeGroup)}:${String(state.status === 'running')}`;
    if (groupKey !== previousGroupKey) {
      const running = state.status === 'running';
      groupElements.forEach((group, index) => {
        group.classList.toggle('is-active', running && index === activeGroup);
        group.classList.toggle('is-done', index < activeGroup);
      });
      previousGroupKey = groupKey;
      const active = groupElements[activeGroup];
      // happy-dom has no layout, so guard the call rather than assuming it exists.
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' });
      }
    }

    status.textContent = announce(state, judgement, cursor);
  }

  return { element, drill: drillElement, render };
}

function classFor(
  state: CharState,
  isCurrent: boolean,
  pending: boolean,
  kind: CharKind,
): string {
  const parts = ['ch'];
  if (kind === 'space') {
    parts.push('ch--space');
  } else if (kind === 'newline') {
    parts.push('ch--newline');
  }
  const stateClass = STATE_CLASS[state];
  if (stateClass) {
    parts.push(stateClass);
  }
  // The current slot is marked even before the first keystroke and while paused
  // (DESIGN.md §4.4), so this must not be conditional on the session running.
  if (isCurrent) {
    parts.push('is-current');
  }
  if (pending && state === 'untyped') {
    parts.push('is-pending');
  }
  return parts.join(' ');
}

function announce(state: SessionState, judgement: Judgement | null, cursor: number): string {
  if (state.status === 'done') {
    return 'Drill complete.';
  }
  if (state.status === 'paused') {
    return 'Paused.';
  }
  const expected = describe(state.target.charAt(cursor));
  const verdict =
    judgement === 'correct'
      ? 'correct'
      : judgement === 'wrong'
        ? 'wrong'
        : judgement === 'ignored'
          ? 'ignored'
          : 'ready';
  return `Position ${String(cursor + 1)} of ${String(state.target.length)}, expected ${expected}, ${verdict}`;
}

function describe(char: string): string {
  if (char === ' ') {
    return 'space';
  }
  if (char === '\n') {
    return 'Enter';
  }
  if (char === '\t') {
    return 'Tab';
  }
  return char;
}
