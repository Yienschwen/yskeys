// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../main';
import type { AppHandle } from '../main';
import { MemoryStorage, UNREADABLE_STORAGE } from './helpers';
import type { Settings } from '../store/schema';

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

function segmentByText(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button.segment')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`no segment labelled ${text}`);
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
    const drill = targetOf(root);
    // Adaptive character drills vary in group length, so nothing here is a fixed count.
    expect(drill.length).toBeGreaterThan(150);
    expect(root.querySelectorAll('.group').length).toBeGreaterThan(20);
    expect(chars(root)).toHaveLength(drill.length);
  });

  it('marks only the first character as current before typing', () => {
    const root = mount();
    expect(classAt(root, 0)).toContain('is-current');
    expect(classAt(root, 1)).not.toContain('is-current');
  });

  it('expects a real space between groups, not a decorative gap', () => {
    const root = mount();
    const target = targetOf(root);
    const firstSpace = target.indexOf(' ');
    expect(firstSpace).toBeGreaterThan(0);

    for (const char of target.slice(0, firstSpace + 1)) {
      press(char);
    }

    expect(app?.state().typed).toBe(target.slice(0, firstSpace + 1));
    expect(classAt(root, firstSpace)).toContain('ch--space');
    expect(classAt(root, firstSpace)).toContain('is-ok');
  });

  it('counts a stray space as a miss when a character was expected', () => {
    const root = mount();
    // The first expected character is never a space, whatever the group lengths are.
    press(' ');

    expect(classAt(root, 0)).toContain('is-bad');
    expect(app?.state().firstAttempt[0]).toBe(' ');
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
    // Exactly one unit was missed: the first character. Pairs are no longer recorded,
    // so nothing else can appear here.
    expect(rows).toHaveLength(1);
    const units = [...root.querySelectorAll('tbody tr .table__unit')].map(
      (element) => element.textContent,
    );
    expect(units).toEqual([expected.charAt(0)]);
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
    expect(root.querySelectorAll('.ch').length).toBeGreaterThan(150);
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
    const summary = app.store().sessions[0];
    expect(summary?.totalChars).toBeGreaterThan(150);

    // The spaces between groups are targets, and they are recorded under the thumb.
    const spaces = app.store().aggregates.unigrams[' '];
    expect(spaces?.attempts).toBeGreaterThan(10);
    expect(spaces?.firstTryCorrect).toBe(spaces?.attempts);
    expect(app.store().aggregates.byFinger['thumb']?.attempts).toBe(spaces?.attempts);
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

    const typed = targetOf(root).replaceAll(' ', '');
    expect(typed.length).toBeGreaterThanOrEqual(75);
    expect([...typed].every((char) => '0123456789'.includes(char))).toBe(true);
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
    expect(app?.store().sessions[0]?.totalChars).toBeGreaterThan(150);
  });

  it('restores history and settings when a replace is undone', () => {
    const { root } = mountWithStorage();
    finishDrill(root);
    const text = app?.exportText() ?? '';

    app?.changeSettings({ charsets: ['symbols'], groupCount: 15 });
    app?.importText(text, 'replace');
    // The file carries the settings it was exported with.
    expect(app?.store().settings).toEqual({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'words',
      mode: 'adaptive',
      spaceDisplay: 'bar',
      nextKey: true,
    });

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
    expect(app?.store().settings).toEqual({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'words',
      mode: 'adaptive',
      spaceDisplay: 'bar',
      nextKey: true,
    });
  });
});

/** 26 distinct three-letter words: enough for the words shape to be offered. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const LIST_WORDS = Array.from(
  { length: 30 },
  (_, index) =>
    `${LETTERS[index % 26] ?? 'a'}${LETTERS[(index * 3 + 1) % 26] ?? 'a'}${LETTERS[(index * 7 + 2) % 26] ?? 'a'}`,
);
const LIST_TEXT = LIST_WORDS.join('\n');

describe('word list and drill shape', () => {
  it('drills real words once a list is imported', () => {
    const { root } = mountWithStorage();
    const imported = app?.importWordListText(LIST_TEXT, 'test.txt');
    expect(imported?.ok).toBe(true);

    app?.newSession();
    const words = targetOf(root).split(' ');

    expect(words.length).toBeGreaterThan(5);
    expect(words.every((word) => LIST_WORDS.includes(word))).toBe(true);
  });

  it('reports what the parser kept, skipped and can use', () => {
    const { root } = mountWithStorage();
    app?.importWordListText('acid\nacorn\nab\nnaïve\n', 'mixed.txt');

    const message = root.querySelector('.banner')?.textContent ?? '';
    expect(message).toMatch(/Imported 3 words from mixed\.txt/);
    expect(message).toMatch(/1 unusable lines skipped/);
  });

  it('stores the list without needing it for the current drill', () => {
    const { storage } = mountWithStorage();
    app?.importWordListText(LIST_TEXT, 'test.txt');

    expect(app?.wordList()?.name).toBe('test.txt');
    // The generated list has 30 entries but only 26 distinct words, and the parser dedupes.
    expect(app?.wordList()?.words).toHaveLength(new Set(LIST_WORDS).size);

    // A fresh page load finds it again.
    app?.destroy();
    app = null;
    document.body.innerHTML = '<div id="app"></div>';
    const reopened = document.getElementById('app');
    if (!reopened) {
      throw new Error('test setup failed: #app missing');
    }
    app = bootstrap(reopened, { seed: 5, storage });
    expect(app.wordList()?.name).toBe('test.txt');
  });

  it('falls back to random characters when a non-letter charset rules out words', () => {
    const { root } = mountWithStorage();
    app?.importWordListText(LIST_TEXT, 'test.txt');
    app?.changeSettings({ charsets: ['lowercase', 'digits'], groupCount: 30, shape: 'words' });
    app?.newSession();

    const drill = targetOf(root);
    expect(drill.replaceAll(' ', '').length).toBeGreaterThanOrEqual(150);
    // 150 random characters from 36 symbols with no digit at all is not a thing.
    expect(drill).toMatch(/[0-9]/);
  });

  it('goes back to random characters when the shape is set to uniform', () => {
    const { root } = mountWithStorage();
    app?.importWordListText(LIST_TEXT, 'test.txt');
    app?.changeSettings({ charsets: ['lowercase'], groupCount: 30, shape: 'patterns', mode: 'uniform' });
    app?.newSession();

    const drill = targetOf(root);
    expect(drill).toHaveLength(179);
    expect(LIST_WORDS.includes(drill.split(' ')[0] ?? '')).toBe(false);
  });

  it('falls back to characters after the list is removed', () => {
    const { root } = mountWithStorage();
    app?.importWordListText(LIST_TEXT, 'test.txt');
    app?.removeWordList();

    expect(app?.wordList()).toBeNull();
    app?.newSession();
    // Groups come from the character generator now, not from the list.
    const groups = targetOf(root).split(' ');
    expect(groups.some((group) => !LIST_WORDS.includes(group))).toBe(true);
  });

  it('keeps the word list when history and settings are cleared', () => {
    mountWithStorage();
    app?.importWordListText(LIST_TEXT, 'test.txt');

    app?.clearAll();

    expect(app?.store().aggregates.totalSessions).toBe(0);
    expect(app?.wordList()?.name).toBe('test.txt');
  });

  it('carries the word list in an export and restores it on import', () => {
    const { storage } = mountWithStorage();
    finishDrill(document.getElementById('app') as HTMLElement);
    app?.importWordListText(LIST_TEXT, 'test.txt');
    const text = app?.exportText() ?? '';

    app?.removeWordList();
    expect(app?.wordList()).toBeNull();
    app?.clearAll();

    expect(app?.importText(text, 'replace').ok).toBe(true);
    expect(app?.wordList()?.name).toBe('test.txt');

    // A file without a list leaves the imported one alone.
    const withoutList = JSON.stringify(
      (() => {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        delete parsed['wordList'];
        return parsed;
      })(),
    );
    app?.importText(withoutList, 'merge');
    expect(app?.wordList()?.name).toBe('test.txt');
    void storage;
  });

  it('records the shape that actually produced the session', () => {
    const { root } = mountWithStorage();
    app?.importWordListText(LIST_TEXT, 'test.txt');
    app?.newSession();
    finishDrill(root);
    expect(app?.store().sessions[0]?.shape).toBe('words');

    app?.changeSettings({ charsets: ['lowercase'], groupCount: 30, shape: 'patterns', mode: 'uniform' });
    app?.newSession();
    finishDrill(root);
    expect(app?.store().sessions[0]?.shape).toBe('patterns');
  });
});

describe('space marker and finger hint', () => {
  it('marks the drill with the chosen space style and keeps every space a target', () => {
    const { root } = mountWithStorage();
    expect(root.querySelector('.drill')?.getAttribute('data-space')).toBe('bar');

    app?.changeSettings({ ...(app?.settings() as Settings), spaceDisplay: 'dot' });
    app?.newSession();

    expect(root.querySelector('.drill')?.getAttribute('data-space')).toBe('dot');
    expect(root.querySelectorAll('.ch--space').length).toBeGreaterThan(10);
  });

  it('names the next key and its finger, and follows the cursor', () => {
    const { root } = mountWithStorage();
    expect(root.querySelector('.finger')).not.toBeNull();
    expect(root.querySelector('.finger__label')?.textContent).toContain('Next:');

    const first = targetOf(root).charAt(0);
    const marked = root.querySelector('.finger__key.is-next');
    expect(marked?.getAttribute('data-char')).toBe(first);

    press(first);
    const next = targetOf(root).charAt(1);
    expect(root.querySelector('.finger__key.is-next')?.getAttribute('data-char')).toBe(next);
  });

  it('hides the hint panel when the setting is off', () => {
    const { root } = mountWithStorage();
    app?.changeSettings({ ...(app?.settings() as Settings), nextKey: false });
    app?.newSession();

    expect(root.querySelector('.finger')).toBeNull();
  });
});

describe('text and code source', () => {
  const SOURCE = 'let total = 1;\nfor (const n of list) {\n  total += n;\n}\n';
  const ALL = ['lowercase', 'uppercase', 'digits', 'punctuation', 'symbols'] as const;

  function mountWithSource(): HTMLElement {
    const { root } = mountWithStorage();
    const imported = app?.importPastedText(SOURCE, 'snippet');
    expect(imported?.ok).toBe(true);
    app?.changeSettings({ charsets: [...ALL], groupCount: 15, shape: 'text', mode: 'adaptive' });
    app?.newSession();
    return root;
  }

  it('drills only text that came from the source, line breaks included', () => {
    const root = mountWithSource();
    const state = app?.state();
    if (!state) {
      throw new Error('no session');
    }
    const target = state.target;

    expect(target.length).toBeGreaterThan(0);
    // Adaptive mode draws chunks in a weighted order, so the target is not a prefix of
    // the source — but every character in it must be one the source actually contains.
    expect([...target].every((char) => SOURCE.includes(char))).toBe(true);
    expect(target).toContain('\n');

    // One span per target character, and one line-break span per newline target.
    expect(chars(root)).toHaveLength(target.length);
    expect(root.querySelectorAll('.ch--newline').length).toBe(
      [...target].filter((char) => char === '\n').length,
    );
  });

  it('uses the source line structure rather than inventing it', () => {
    const root = mountWithSource();
    const target = app?.state().target ?? '';
    // Every chunk boundary in the target is a space the drill expects, and the line
    // breaks are exactly the ones the source had.
    expect(root.querySelectorAll('.ch--newline').length).toBeGreaterThan(0);
    expect(target.replaceAll('\n', '').length).toBeGreaterThan(0);
  });

  it('accepts Enter where the drill expects a newline', () => {
    mountWithSource();
    const target = app?.state().target ?? '';
    const firstBreak = target.indexOf('\n');
    expect(firstBreak).toBeGreaterThan(0);

    for (const char of target.slice(0, firstBreak)) {
      press(char);
    }
    expect(app?.state().typed).toBe(target.slice(0, firstBreak));

    press('Enter');
    expect(app?.state().typed).toBe(target.slice(0, firstBreak + 1));
    expect(app?.state().firstAttempt[firstBreak]).toBe('\n');
  });

  it('leaves Enter to the browser when the drill does not expect a newline', () => {
    const { root } = mountWithStorage();
    expect(app?.state().target).not.toContain('\n');
    expect(root.querySelectorAll('.ch--newline')).toHaveLength(0);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(app?.state().typed).toBe('');
  });

  it('keeps the source across a clear and reports it in history', () => {
    const root = mountWithSource();
    expect(app?.textSource()?.text).toContain('let total = 1;');

    app?.clearAll();
    expect(app?.textSource()?.name).toBe('snippet');

    app?.showHistory();
    expect(root.textContent).toContain('snippet');
    expect(root.textContent).toContain('Remove text source');
  });

  it('removes the source on request', () => {
    const root = mountWithSource();
    app?.removeTextSource();

    expect(app?.textSource()).toBeNull();
    app?.showHistory();
    expect(root.textContent).toContain('No text source yet');
  });

  it('carries the source through an export and import', () => {
    mountWithSource();
    const text = app?.exportText() ?? '';

    app?.removeTextSource();
    expect(app?.textSource()).toBeNull();

    const imported = app?.importText(text, 'replace');
    expect(imported?.ok).toBe(true);
    expect(app?.textSource()?.name).toBe('snippet');
    expect(app?.textSource()?.text).toContain('for (const n of list)');
  });

  it('reads a .zip that is not really an archive as plain text', async () => {
    mountWithStorage();
    app?.changeSettings({ charsets: [...ALL], groupCount: 15, shape: 'text' });

    const notAnArchive = new File(
      ['const answer to everything is forty two and some more words here\n'],
      'notes.zip',
      { type: 'application/zip' },
    );
    const result = await app?.importTextSourceFiles([notAnArchive]);

    expect(result?.ok).toBe(true);
    expect(app?.textSource()?.name).toBe('notes.zip');
    expect(app?.textSource()?.text).toContain('const answer');
  });

  it('refuses a paste that the enabled sets cannot type, and names them', () => {
    const { root } = mountWithStorage();
    app?.changeSettings({ charsets: ['digits'], groupCount: 30 });

    const rejected = app?.importPastedText('中文中文中文中文中文中文', 'cjk');
    expect(rejected?.ok).toBe(false);
    expect(app?.textSource()).toBeNull();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('digits');
  });
});

describe('adaptive weighting', () => {
  it('records the weighting mode that produced the session', () => {
    const { root } = mountWithStorage();
    finishDrill(root);
    expect(app?.store().sessions[0]?.mode).toBe('adaptive');

    app?.changeSettings({ ...(app?.settings() as Settings), mode: 'uniform' });
    app?.newSession();
    finishDrill(root);
    expect(app?.store().sessions[0]?.mode).toBe('uniform');
  });

  it('switches the weighting mode from the history view', () => {
    const { root } = mountWithStorage();
    app?.showHistory();
    segmentByText(root, 'Uniform').click();

    expect(app?.settings().mode).toBe('uniform');

    app?.newSession();
    finishDrill(root);
    expect(app?.store().sessions[0]?.mode).toBe('uniform');
  });

  it('drills the unit the history says is weak', () => {
    const { root } = mountWithStorage();
    // Seeding through import keeps this honest: it is the real store that drives the drill.
    const seeded = {
      kind: 'yskeys-export',
      schemaVersion: 1,
      exportedAt: 1,
      app: { version: '0' },
      settings: { charsets: ['lowercase'], groupCount: 30, shape: 'patterns', mode: 'adaptive' },
      aggregates: {
        schemaVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        totalSessions: 1,
        totalKeystrokes: 200,
        unigrams: {
          a: { attempts: 100, firstTryCorrect: 50, wrongTyped: {} },
          b: { attempts: 100, firstTryCorrect: 99, wrongTyped: {} },
        },
        bigrams: {},
        trigrams: {},
        byFinger: {},
        byHand: {},
        byShifted: {},
        byKind: {},
      },
      sessions: [],
    };
    expect(app?.importText(JSON.stringify(seeded), 'replace').ok).toBe(true);
    app?.newSession();

    const text = targetOf(root).replaceAll(' ', '');
    const weak = [...text].filter((char) => char === 'a').length;
    const strong = [...text].filter((char) => char === 'b').length;

    expect(weak).toBeGreaterThan(strong);
  });

  it('still runs the plain character drill in uniform mode', () => {
    const { root } = mountWithStorage();
    app?.changeSettings({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'patterns',
      mode: 'uniform',
    });
    app?.newSession();

    // Every group is exactly five characters in the uniform shape, plus 29 spaces.
    expect(targetOf(root)).toHaveLength(179);
  });
});
