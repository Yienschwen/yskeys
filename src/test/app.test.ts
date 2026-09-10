// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../main';
import type { AppHandle } from '../main';
import { MemoryStorage, UNREADABLE_STORAGE } from './helpers';

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

/** Mounts with an injected storage so nothing touches the real localStorage. */
function mountWithStorage(seed = 1234): { root: HTMLElement; storage: MemoryStorage } {
  const storage = new MemoryStorage();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('test setup failed: #app missing');
  }
  app = bootstrap(root, { seed, storage });
  return { root, storage };
}

/** Types the whole drill correctly. The target is read before anything is typed. */
function finishDrill(root: HTMLElement): void {
  for (const char of targetOf(root)) {
    press(char);
  }
}

/**
 * Finds a button inside one view. The header holds its own controls now, so a bare
 * `querySelector('button')` would happily return a settings pill instead.
 */
function viewButton(root: HTMLElement, container: string, text?: string): HTMLButtonElement {
  const found = [...root.querySelectorAll(`${container} button`)].find(
    (candidate) => text === undefined || candidate.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`no button matching ${text ?? '*'} inside ${container}`);
  }
  return found;
}

afterEach(() => {
  app?.destroy();
  app = null;
  document.body.innerHTML = '';
});

describe('app wiring', () => {
  it('renders one span per character, in groups', () => {
    const root = mount();
    expect(chars(root)).toHaveLength(179);
    expect(root.querySelectorAll('.group')).toHaveLength(30);
    expect(targetOf(root)).toHaveLength(179);
  });

  it('marks only the first character as current before typing', () => {
    const root = mount();
    expect(classAt(root, 0)).toContain('is-current');
    expect(classAt(root, 1)).not.toContain('is-current');
  });

  it('expects a real space between groups, not a decorative gap', () => {
    const root = mount();
    const target = targetOf(root);
    expect(target).toContain(' ');

    // The first group plus the space that follows it.
    for (const char of target.slice(0, 6)) {
      press(char);
    }

    expect(app?.state().typed).toBe(target.slice(0, 6));
    expect(classAt(root, 5)).toContain('ch--space');
    expect(classAt(root, 5)).toContain('is-ok');
  });

  it('counts a stray space inside a group as a miss like any other key', () => {
    const root = mount();
    const target = targetOf(root);
    press(target.charAt(0));
    press(' ');

    expect(classAt(root, 1)).toContain('is-bad');
    expect(app?.state().firstAttempt[1]).toBe(' ');
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

    viewButton(root, '.pause-panel').click();
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
    expect(viewButton(root, '.result').textContent).toBe('Again');
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
    viewButton(root, '.result', 'Again').click();
    expect(app?.state().typed).toBe('');
    expect(app?.state().status).toBe('ready');
    expect(root.querySelectorAll('.ch')).toHaveLength(179);
    expect(root.textContent).not.toBe(before);
  });
});

describe('persistence, settings and history', () => {
  it('saves a finished session and reloads it on the next visit', () => {
    const { root, storage } = mountWithStorage();
    finishDrill(root);

    expect(app?.store().aggregates.totalSessions).toBe(1);
    expect(app?.store().sessions).toHaveLength(1);
    expect(storage.length).toBeGreaterThan(0);

    app?.destroy();
    app = null;
    document.body.innerHTML = '<div id="app"></div>';
    const reopened = document.getElementById('app');
    if (!reopened) {
      throw new Error('test setup failed: #app missing');
    }
    app = bootstrap(reopened, { seed: 9, storage });

    expect(app.store().aggregates.totalSessions).toBe(1);
    expect(app.store().sessions[0]?.totalChars).toBe(179);

    // The 29 spaces between the 30 groups are targets, and they are recorded.
    expect(app.store().aggregates.unigrams[' ']?.attempts).toBe(29);
    expect(app.store().aggregates.unigrams[' ']?.firstTryCorrect).toBe(29);
    expect(app.store().aggregates.byFinger['thumb']?.attempts).toBe(29);
  });

  it('does not save a session that was abandoned with Escape', () => {
    const { root } = mountWithStorage();
    press(targetOf(root).charAt(0));
    press('Escape');

    expect(app?.store().aggregates.totalSessions).toBe(0);
  });

  it('applies a settings change to the next drill and keeps it', () => {
    const { root } = mountWithStorage();
    app?.changeSettings({ charsets: ['digits'], groupCount: 15 });
    app?.newSession();

    const drill = targetOf(root);
    expect(drill).toHaveLength(89);
    expect([...drill].every((char) => char === ' ' || '0123456789'.includes(char))).toBe(true);
    expect(app?.store().settings).toEqual({ charsets: ['digits'], groupCount: 15 });
  });

  it('leaves the drill alone when settings change mid-session', () => {
    const { root } = mountWithStorage();
    const before = targetOf(root);
    app?.changeSettings({ charsets: ['digits'], groupCount: 15 });

    expect(targetOf(root)).toBe(before);
  });

  it('ignores typing while the history view is open', () => {
    const { root } = mountWithStorage();
    app?.showHistory();
    expect(root.textContent).toContain('No finished sessions yet');

    press('a');
    expect(app?.state().typed).toBe('');

    app?.showPractice();
    press(targetOf(root).charAt(0));
    expect(app?.state().typed).toHaveLength(1);
  });

  it('round-trips an export through clear and replace', () => {
    const { root } = mountWithStorage();
    finishDrill(root);
    const text = app?.exportText() ?? '';

    app?.clearAll();
    expect(app?.store().aggregates.totalSessions).toBe(0);

    const imported = app?.importText(text, 'replace');
    expect(imported?.ok).toBe(true);
    expect(app?.store().aggregates.totalSessions).toBe(1);
    expect(app?.store().sessions[0]?.totalChars).toBe(179);
  });

  it('restores history and settings when a replace is undone', () => {
    const { root } = mountWithStorage();
    finishDrill(root);
    const text = app?.exportText() ?? '';

    app?.changeSettings({ charsets: ['symbols'], groupCount: 15 });
    app?.importText(text, 'replace');
    // The file carries the settings it was exported with.
    expect(app?.store().settings).toEqual({ charsets: ['lowercase'], groupCount: 30 });

    expect(app?.undoReplace()).toBe(true);
    expect(app?.store().settings).toEqual({ charsets: ['symbols'], groupCount: 15 });
    expect(app?.store().aggregates.totalSessions).toBe(1);
  });

  it('merges its own export without duplicating the session', () => {
    const { root } = mountWithStorage();
    finishDrill(root);
    const text = app?.exportText() ?? '';

    const merged = app?.importText(text, 'merge');

    expect(merged?.ok).toBe(true);
    expect(app?.store().aggregates.totalSessions).toBe(2);
    expect(app?.store().sessions).toHaveLength(1);
  });

  it('reports a failed import and keeps the history that is already there', () => {
    const { root } = mountWithStorage();
    finishDrill(root);

    const failed = app?.importText('not json at all', 'merge');

    expect(failed?.ok).toBe(false);
    expect(app?.store().aggregates.totalSessions).toBe(1);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Import failed');
  });

  it('renders the totals and tables once there is something to show', () => {
    const { root } = mountWithStorage();
    finishDrill(root);
    app?.showHistory();

    const text = root.textContent ?? '';
    expect(text).toContain('Totals');
    expect(text).toContain('Characters per minute');
    expect(text).toContain('By character kind, Shift and hand');
    expect(root.querySelectorAll('table').length).toBeGreaterThan(0);
    // The DOM test types instantly, so no session reaches the speed window and the
    // chart legitimately shows its empty state. The chart itself is covered in
    // history-view.test.ts with real CPM values.
    expect(text).toContain('No finished sessions yet.');
  });

  it('warns without a dismiss control when storage cannot be used', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app');
    if (!root) {
      throw new Error('test setup failed: #app missing');
    }
    app = bootstrap(root, { seed: 3, storage: UNREADABLE_STORAGE });

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/cannot be saved/);
    expect(alert?.querySelector('button')).toBeNull();
  });

  it('clears history and settings together', () => {
    const { root } = mountWithStorage();
    app?.changeSettings({ charsets: ['symbols'], groupCount: 15 });
    finishDrill(root);

    app?.clearAll();

    expect(app?.store().aggregates.totalSessions).toBe(0);
    expect(app?.store().settings).toEqual({ charsets: ['lowercase'], groupCount: 30 });
  });
});
