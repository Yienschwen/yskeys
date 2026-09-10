import { charStateAt, cursorIndex } from '../core/engine';
import type { CharState, Judgement, SessionState } from '../core/engine';
import type { Drill } from '../core/generator';
import { h } from './dom';

/**
 * Renders one drill. Every character gets a fixed-width span whose class changes in
 * place, so no state change can reflow the line (DESIGN.md §2.3).
 *
 * Groups are separated by a real space character, not by decoration: the space is a
 * target the user has to type, and the span for it draws a low bar because an empty
 * box would be invisible. Groups are variable length, so the active group is found by
 * range rather than by dividing the cursor by a fixed size.
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

export function createTypingView(drill: Drill): TypingView {
  viewCounter += 1;
  const statusId = `drill-status-${String(viewCounter)}`;

  const element = h('div', 'typing');
  const drillElement = h('div', 'drill');
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
  const spaceFlags: boolean[] = [];
  const groupElements: HTMLElement[] = [];
  const groupRanges: Array<{ start: number; end: number }> = [];

  let offset = 0;
  const lastGroup = drill.groups.length - 1;

  drill.groups.forEach((word, index) => {
    const start = offset;
    const groupElement = h('span', 'group');
    for (const char of word) {
      const charElement = h('span', 'ch', char);
      charElements.push(charElement);
      spaceFlags.push(false);
      groupElement.append(charElement);
      offset += 1;
    }
    groupElements.push(groupElement);
    drillElement.append(groupElement);

    if (index < lastGroup) {
      const spaceElement = h('span', 'ch ch--space', ' ');
      charElements.push(spaceElement);
      spaceFlags.push(true);
      drillElement.append(spaceElement);
      offset += 1;
    }

    groupRanges.push({ start, end: offset });
  });

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
          spaceFlags[index] === true,
        );
        previousStates[index] = charState;
        previousCurrent[index] = isCurrent;
      }
    }

    const activeGroup = groupIndexFor(cursor);
    const groupKey = `${String(activeGroup)}:${String(state.status === 'running')}`;
    if (groupKey !== previousGroupKey) {
      const running = state.status === 'running';
      groupElements.forEach((groupElement, index) => {
        groupElement.classList.toggle('is-active', running && index === activeGroup);
        groupElement.classList.toggle('is-done', index < activeGroup);
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
  space: boolean,
): string {
  const parts = ['ch'];
  if (space) {
    parts.push('ch--space');
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
  return char === ' ' ? 'space' : char;
}
