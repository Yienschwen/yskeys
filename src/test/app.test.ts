// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../main';
import type { AppHandle } from '../main';

/**
 * The only automated check of the interactive layer. It drives the real app
 * through synthetic keyboard events and asserts on the DOM, because the pure
 * tests in engine.test.ts cannot catch a wiring mistake.
 */

let app: AppHandle | null = null;

function mount(seed = 1234): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('test setup failed: #app missing');
  }
  app = bootstrap(root, { seed });
  return root;
}

function chars(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.ch')];
}

function targetOf(root: HTMLElement): string {
  return chars(root)
    .map((element) => element.textContent ?? '')
    .join('');
}

function classAt(root: HTMLElement, index: number): string {
  return chars(root)[index]?.className ?? '';
}

function press(key: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

/** A character that is guaranteed to differ from the expected one. */
function wrongFor(expected: string): string {
  return expected === 'a' ? 'b' : 'a';
}

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.innerHTML = '';
});

describe('app wiring', () => {
  it('renders one span per character, in groups', () => {
    const root = mount();
    expect(chars(root)).toHaveLength(150);
    expect(root.querySelectorAll('.group')).toHaveLength(30);
    expect(targetOf(root)).toHaveLength(150);
  });

  it('marks only the first character as current before typing', () => {
    const root = mount();
    expect(classAt(root, 0)).toContain('is-current');
    expect(classAt(root, 1)).not.toContain('is-current');
  });

  it('marks correct characters and advances the cursor', () => {
    const root = mount();
    press(targetOf(root).charAt(0));
    expect(classAt(root, 0)).toContain('is-ok');
    expect(classAt(root, 0)).not.toContain('is-current');
    expect(classAt(root, 1)).toContain('is-current');
  });

  it('marks a wrong character as bad and still advances', () => {
    const root = mount();
    press(wrongFor(targetOf(root).charAt(0)));
    expect(classAt(root, 0)).toContain('is-bad');
    expect(classAt(root, 1)).toContain('is-current');
  });

  it('backspace clears the display but the sample stays wrong', () => {
    const root = mount();
    const expected = targetOf(root);
    const wrong = wrongFor(expected.charAt(0));

    press(wrong);
    expect(classAt(root, 0)).toContain('is-bad');

    press('Backspace');
    expect(classAt(root, 0)).not.toContain('is-bad');
    expect(classAt(root, 0)).toContain('is-current');

    press(expected.charAt(0));
    expect(classAt(root, 0)).toContain('is-fixed');
    expect(app?.state().firstAttempt[0]).toBe(wrong);
  });

  it('ignores modifier combinations, Tab, Shift and auto-repeat', () => {
    const root = mount();
    press('a', { ctrlKey: true });
    press('Tab');
    press('Shift');
    press('a', { repeat: true });
    expect(chars(root).some((element) => element.classList.contains('is-ok'))).toBe(false);
    expect(chars(root).some((element) => element.classList.contains('is-bad'))).toBe(false);
    expect(classAt(root, 0)).toContain('is-current');
  });

  it('starts a fresh drill on Escape', () => {
    const root = mount();
    press(targetOf(root).charAt(0));
    expect(classAt(root, 0)).toContain('is-ok');

    press('Escape');
    expect(chars(root).some((element) => element.classList.contains('is-ok'))).toBe(false);
    expect(classAt(root, 0)).toContain('is-current');
    expect(app?.state().typed).toBe('');
  });

  it('pauses on window blur and resumes on click', () => {
    const root = mount();
    const expected = targetOf(root);
    press(expected.charAt(0));

    window.dispatchEvent(new Event('blur'));
    expect(app?.state().status).toBe('paused');
    expect(root.textContent).toContain('Paused');
    expect(root.querySelector('.drill')).toBeNull();

    press(expected.charAt(1));
    expect(app?.state().typed).toHaveLength(1);

    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(app?.state().status).toBe('running');
    expect(root.querySelector('.drill')).not.toBeNull();
  });

  it('finishes a flawless drill and swaps to the result view', () => {
    const root = mount();
    for (const char of targetOf(root)) {
      press(char);
    }
    expect(app?.state().status).toBe('done');
    expect(root.querySelector('.drill')).toBeNull();
    expect(root.textContent).toContain('Session complete');
    expect(root.textContent).toContain('Nothing was missed');
    expect(root.querySelector('button')?.textContent).toBe('Again');
  });

  it('lists the missed units when the drill had mistakes', () => {
    const root = mount();
    const expected = targetOf(root);
    const keys = [...expected];
    keys[0] = wrongFor(expected.charAt(0));

    for (const key of keys) {
      press(key);
    }

    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const units = [...root.querySelectorAll('tbody tr .table__unit')].map(
      (element) => element.textContent,
    );
    // Both the character and the pair it was part of were missed once. Order is
    // by error count then accuracy, so the 0%-accuracy pair ranks first.
    expect(units).toContain(expected.charAt(0));
    expect(units).toContain(expected.slice(0, 2));
  });

  it('replays through the Again button', () => {
    const root = mount();
    for (const char of targetOf(root)) {
      press(char);
    }
    const before = root.textContent;
    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(app?.state().typed).toBe('');
    expect(app?.state().status).toBe('ready');
    expect(root.querySelectorAll('.ch')).toHaveLength(150);
    expect(root.textContent).not.toBe(before);
  });
});
