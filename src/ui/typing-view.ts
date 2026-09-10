import { charStateAt, cursorIndex } from '../core/engine';
import type { CharState, Judgement, SessionState } from '../core/engine';
import type { Drill } from '../core/generator';
import { h } from './dom';

/**
 * Renders one drill. Every character is a fixed-width span whose class changes
 * in place, so no state change can reflow the line (DESIGN.md §2.3).
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

export function createTypingView(drill: Drill, groupSize: number): TypingView {
  viewCounter += 1;
  const statusId = `drill-status-${String(viewCounter)}`;

  const element = h('div', 'typing');
  const drillElement = h('div', 'drill');
  drillElement.setAttribute('role', 'application');
  drillElement.setAttribute(
    'aria-label',
    'Typing drill. Type the characters shown, in order. Escape starts a new drill.',
  );
  drillElement.tabIndex = 0;

  const status = h('p', 'visually-hidden');
  status.id = statusId;
  status.setAttribute('aria-live', 'polite');
  drillElement.setAttribute('aria-describedby', statusId);

  const charElements: HTMLElement[] = [];
  const groupElements: HTMLElement[] = [];

  for (const group of drill.groups) {
    const groupElement = h('span', 'group');
    for (const char of group) {
      const charElement = h('span', 'ch', char);
      charElements.push(charElement);
      groupElement.append(charElement);
    }
    groupElements.push(groupElement);
    drillElement.append(groupElement);
  }

  element.append(drillElement, status);

  let previousStates: CharState[] = [];
  let previousCurrent: boolean[] = [];
  let previousPending = false;
  let previousGroupKey = '';

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
        charElement.className = classFor(charState, isCurrent, pending);
        previousStates[index] = charState;
        previousCurrent[index] = isCurrent;
      }
    }

    const activeGroup = Math.min(Math.floor(cursor / groupSize), groupElements.length - 1);
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

function classFor(state: CharState, isCurrent: boolean, pending: boolean): string {
  const parts = ['ch'];
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
