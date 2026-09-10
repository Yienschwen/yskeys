// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../store/schema';
import type { Settings } from '../store/schema';
import { createSettingsControls } from '../ui/settings-controls';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(initial: Settings = defaultSettings(), words = { available: true, hint: '' }) {
  const onChange = vi.fn();
  const controls = createSettingsControls(initial, onChange, {
    wordsAvailable: words.available,
    wordsHint: words.hint,
  });
  document.body.append(controls.element);
  return { controls, onChange };
}

function pill(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button.pill')].find((candidate) =>
    (candidate.textContent ?? '').includes(label),
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`no pill labelled ${label}`);
  }
  return found;
}

function segment(root: HTMLElement, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button.segment')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`no segment labelled ${label}`);
  }
  return found;
}

describe('settings controls', () => {
  it('marks the active set as pressed and the rest as not', () => {
    const { controls } = mount();
    expect(pill(controls.element, 'a–z').getAttribute('aria-pressed')).toBe('true');
    expect(pill(controls.element, 'A–Z').getAttribute('aria-pressed')).toBe('false');
    expect(pill(controls.element, '0–9').getAttribute('aria-pressed')).toBe('false');
  });

  it('turns a second set on and reports the next settings', () => {
    const { controls, onChange } = mount();
    pill(controls.element, 'A–Z').click();

    expect(onChange).toHaveBeenCalledWith({
      charsets: ['lowercase', 'uppercase'],
      groupCount: 30,
      shape: 'words',
      mode: 'adaptive',
    });
    expect(pill(controls.element, 'A–Z').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches a set off once another one is on', () => {
    const { controls, onChange } = mount();
    pill(controls.element, '0–9').click();
    pill(controls.element, 'a–z').click();

    expect(onChange).toHaveBeenLastCalledWith({
      charsets: ['digits'],
      groupCount: 30,
      shape: 'words',
      mode: 'adaptive',
    });
    expect(pill(controls.element, 'a–z').getAttribute('aria-pressed')).toBe('false');
  });

  it('refuses to switch off the last remaining set, and says why', () => {
    const { controls, onChange } = mount();
    const only = pill(controls.element, 'a–z');

    expect(only.disabled).toBe(true);
    expect(only.title).toMatch(/at least one/i);

    only.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(only.getAttribute('aria-pressed')).toBe('true');
  });

  it('re-enables the previous set as soon as another one joins it', () => {
    const { controls } = mount();
    pill(controls.element, 'A–Z').click();
    expect(pill(controls.element, 'a–z').disabled).toBe(false);
  });

  it('reports a new group count', () => {
    const { controls, onChange } = mount();
    const select = controls.element.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('no select rendered');
    }
    expect([...select.options].map((option) => option.value)).toEqual(['15', '30', '60']);
    expect(select.value).toBe('30');

    select.value = '60';
    select.dispatchEvent(new Event('change'));

    expect(onChange).toHaveBeenCalledWith({
      charsets: ['lowercase'],
      groupCount: 60,
      shape: 'words',
      mode: 'adaptive',
    });
  });

  it('ignores a group count that is not a number', () => {
    const { controls, onChange } = mount();
    const select = controls.element.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('no select rendered');
    }
    const rogue = document.createElement('option');
    rogue.value = 'many';
    select.append(rogue);
    select.value = 'many';
    select.dispatchEvent(new Event('change'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reflects settings changed from outside', () => {
    const { controls } = mount();
    controls.update({ charsets: ['symbols'], groupCount: 15 });

    expect(pill(controls.element, 'Symbols').getAttribute('aria-pressed')).toBe('true');
    expect(pill(controls.element, 'a–z').getAttribute('aria-pressed')).toBe('false');
    expect(controls.element.querySelector('select')?.value).toBe('15');
  });

  it('reports a shape change', () => {
    const { controls, onChange } = mount();
    segment(controls.element, 'Characters').click();

    expect(onChange).toHaveBeenCalledWith({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'uniform',
      mode: 'adaptive',
    });
    expect(segment(controls.element, 'Characters').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables the words option and shows why when no list is usable', () => {
    const { controls, onChange } = mount(defaultSettings(), {
      available: false,
      hint: 'Import a word list in History',
    });
    const words = segment(controls.element, 'Words');

    expect(words.disabled).toBe(true);
    expect(words.title).toBe('Import a word list in History');
    expect(controls.element.textContent).toContain('Import a word list in History');

    words.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picks the words state up later, once a list arrives', () => {
    const { controls } = mount(defaultSettings(), { available: false, hint: 'no list' });
    controls.setWordsState(true, '');

    expect(segment(controls.element, 'Words').disabled).toBe(false);
    expect(controls.element.textContent).not.toContain('no list');
  });
});
