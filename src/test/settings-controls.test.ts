// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../store/schema';
import type { Settings } from '../store/schema';
import { createSettingsControls } from '../ui/settings-controls';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(initial: Settings = defaultSettings()) {
  const onChange = vi.fn();
  const controls = createSettingsControls(initial, onChange);
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

    expect(onChange).toHaveBeenCalledWith({ charsets: ['lowercase', 'uppercase'], groupCount: 30 });
    expect(pill(controls.element, 'A–Z').getAttribute('aria-pressed')).toBe('true');
  });

  it('switches a set off once another one is on', () => {
    const { controls, onChange } = mount();
    pill(controls.element, '0–9').click();
    pill(controls.element, 'a–z').click();

    expect(onChange).toHaveBeenLastCalledWith({ charsets: ['digits'], groupCount: 30 });
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

    expect(onChange).toHaveBeenCalledWith({ charsets: ['lowercase'], groupCount: 60 });
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
});
