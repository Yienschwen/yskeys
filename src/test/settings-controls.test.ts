// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../store/schema';
import type { Settings } from '../store/schema';
import { createSettingsControls } from '../ui/settings-controls';
import type { ShapeAvailability } from '../ui/settings-controls';

afterEach(() => {
  document.body.innerHTML = '';
});

const ALL_SHAPES: Record<'words' | 'text' | 'patterns', ShapeAvailability> = {
  words: { available: true, hint: '' },
  text: { available: true, hint: '' },
  patterns: { available: true, hint: '' },
};

function mount(
  initial: Settings = defaultSettings(),
  shapes: Partial<Record<'words' | 'text' | 'patterns', ShapeAvailability>> = {},
) {
  const onChange = vi.fn();
  const controls = createSettingsControls(initial, onChange, {
    shapes: { ...ALL_SHAPES, ...shapes },
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
      spaceDisplay: 'bar',
      nextKey: true,
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
      spaceDisplay: 'bar',
      nextKey: true,
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
      spaceDisplay: 'bar',
      nextKey: true,
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

  it('offers all three drill shapes and reports a change', () => {
    const { controls, onChange } = mount();
    for (const label of ['Words', 'Text / code', 'Patterns']) {
      expect(segment(controls.element, label)).toBeDefined();
    }

    segment(controls.element, 'Patterns').click();

    expect(onChange).toHaveBeenCalledWith({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'patterns',
      mode: 'adaptive',
      spaceDisplay: 'bar',
      nextKey: true,
    });
    expect(segment(controls.element, 'Patterns').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables the words option and shows why when no list is usable', () => {
    const { controls, onChange } = mount(defaultSettings(), {
      words: { available: false, hint: 'Import a word list in History' },
    });
    const words = segment(controls.element, 'Words');

    expect(words.disabled).toBe(true);
    expect(words.title).toBe('Import a word list in History');
    expect(controls.element.textContent).toContain('Import a word list in History');

    words.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('picks a shape state up later, once the material arrives', () => {
    // 'text' has to be the selected shape for its hint to be worth showing.
    const { controls } = mount(
      { ...defaultSettings(), shape: 'text' },
      { text: { available: false, hint: 'no text source' } },
    );
    expect(segment(controls.element, 'Text / code').disabled).toBe(true);
    expect(controls.element.textContent).toContain('no text source');

    controls.setShapeState('text', true, '');

    expect(segment(controls.element, 'Text / code').disabled).toBe(false);
    expect(controls.element.textContent).not.toContain('no text source');
  });

  it('offers every space marker and reports the choice', () => {
    const { controls, onChange } = mount();
    const labels = ['Blank', 'Dot', 'Bar', 'Dash'];
    for (const label of labels) {
      expect(segment(controls.element, label)).toBeDefined();
    }
    // Bar is the default.
    expect(segment(controls.element, 'Bar').getAttribute('aria-pressed')).toBe('true');

    segment(controls.element, 'Dot').click();

    expect(onChange).toHaveBeenCalledWith({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'words',
      mode: 'adaptive',
      spaceDisplay: 'dot',
      nextKey: true,
    });
    expect(segment(controls.element, 'Dot').getAttribute('aria-pressed')).toBe('true');
    expect(segment(controls.element, 'Bar').getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles the finger hint on and off', () => {
    const { controls, onChange } = mount();
    expect(segment(controls.element, 'Finger hint').getAttribute('aria-pressed')).toBe('true');

    segment(controls.element, 'Hidden').click();

    expect(onChange).toHaveBeenCalledWith({
      charsets: ['lowercase'],
      groupCount: 30,
      shape: 'words',
      mode: 'adaptive',
      spaceDisplay: 'bar',
      nextKey: false,
    });
  });
});
