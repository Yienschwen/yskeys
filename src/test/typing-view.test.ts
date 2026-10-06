// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { applyEvent, createSession } from '../core/engine';
import type { SessionState } from '../core/engine';
import type { Drill } from '../core/generator';
import { createTypingView } from '../ui/typing-view';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(drill: Drill) {
  const view = createTypingView(drill, { spaceDisplay: 'bar' });
  document.body.append(view.element);
  return view;
}

function drillOf(groups: readonly string[], separator = ' '): Drill {
  return { groups, text: groups.join(separator), separator, lineBreaks: 0 };
}

/** The target the rendered spans imply, in order, treating a break span as a newline. */
function renderedTarget(view: { drill: HTMLElement }): string {
  return [...view.drill.querySelectorAll('.ch')]
    .map((span) => (span.classList.contains('ch--newline') ? '\n' : (span.textContent ?? '')))
    .join('');
}

function type(state: SessionState, keys: readonly string[]): SessionState {
  let next = state;
  let at = 1000;
  for (const key of keys) {
    next = applyEvent(next, { type: 'key', key, at }).state;
    at += 100;
  }
  return next;
}

describe('typing view rendering', () => {
  it('renders one span per target character, in target order, with a separator', () => {
    const drill = drillOf(['ab', 'cd', 'ef']);
    const view = mount(drill);
    const state = createSession({ target: drill.text, groupSize: 2 });
    view.render(state, null);

    expect(renderedTarget(view)).toBe(drill.text);
    expect(view.drill.querySelectorAll('.group')).toHaveLength(3);
    expect(view.drill.querySelectorAll('.ch--space')).toHaveLength(2);
    expect(view.drill.dataset['space']).toBe('bar');
  });

  it('renders newline chunks as targets in the order they appear', () => {
    const drill = drillOf(['let a = 1;', '\n', 'let b = 2;', '\n', '}'], '');
    const view = mount(drill);
    const state = createSession({ target: drill.text, groupSize: 10 });
    view.render(state, null);

    expect(renderedTarget(view)).toBe(drill.text);
    expect(view.drill.querySelectorAll('.ch--newline')).toHaveLength(2);
    // Newlines are not part of any group: they end the line instead.
    expect(view.drill.querySelectorAll('.group')).toHaveLength(3);
    expect(view.drill.querySelectorAll('.ch--space')).toHaveLength(0);
  });

  it('copes with a drill that starts with a line break', () => {
    const drill = drillOf(['\n', 'first'], '');
    const view = mount(drill);
    const state = createSession({ target: drill.text, groupSize: 6 });
    view.render(state, null);

    expect(renderedTarget(view)).toBe(drill.text);
    expect(view.drill.querySelectorAll('.group')).toHaveLength(1);
    expect(view.drill.querySelectorAll('.ch--newline')).toHaveLength(1);
  });

  it('marks the current position on the newline span and on the group after it', () => {
    const drill = drillOf(['ab', '\n', 'cd'], '');
    const view = mount(drill);
    const state = createSession({ target: drill.text, groupSize: 2 });
    view.render(state, null);

    // Position 1 is inside the first group, so the group is active.
    view.render(type(state, ['a']), 'correct');
    const groups = view.drill.querySelectorAll('.group');
    expect(groups[0]?.className).toContain('is-active');

    // Position 2 is the newline itself: the mark moves onto the break span, and the
    // group it belongs to is done.
    view.render(type(state, ['a', 'b']), 'correct');
    expect(view.drill.querySelector('.ch--newline')?.className).toContain('is-current');
    expect(groups[0]?.className).toContain('is-done');

    // Position 3 is the first character of the second line.
    view.render(type(state, ['a', 'b', 'Enter']), 'correct');
    expect(groups[1]?.className.trim()).toContain('is-active');
    expect(renderedTarget(view).charAt(2)).toBe('\n');
  });

  it('keeps a missed newline marked as missed after the cursor moves on', () => {
    const drill = drillOf(['ab', '\n', 'cd'], '');
    const view = mount(drill);
    const state = createSession({ target: drill.text, groupSize: 2 });
    // Type 'a', 'b', then a space where the newline was expected, then 'c'.
    const played = type(state, ['a', 'b', ' ', 'c']);
    view.render(played, 'wrong');

    expect(played.firstAttempt[2]).toBe(' ');
    expect(view.drill.querySelector('.ch--newline')?.className).toContain('is-bad');
  });

  it('renders an untyped drill with only the first position current', () => {
    const view = mount(drillOf(['abc', 'def']));
    view.render(createSession({ target: 'abc def', groupSize: 3 }), null);

    const spans = [...view.drill.querySelectorAll('.ch')];
    expect(spans.filter((span) => span.classList.contains('is-current'))).toHaveLength(1);
    expect(spans[0]?.className).toContain('is-current');
    // Pending styling applies before the first key.
    expect(spans[0]?.className).toContain('is-pending');
  });
});
