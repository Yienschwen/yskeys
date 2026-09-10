import { SESSION_GROUP_COUNTS } from '../config';
import { CHARSETS } from '../core/charset';
import type { CharsetId } from '../core/charset';
import type { Settings } from '../store/schema';
import { h } from './dom';

/**
 * The settings row (PROJECT.md F10). Changes apply to the next drill, never to a
 * session already in flight, and turning off the last character set is prevented at
 * the UI level rather than being rejected somewhere downstream.
 */

export interface SettingsControls {
  readonly element: HTMLElement;
  update(settings: Settings): void;
}

export function createSettingsControls(
  initial: Settings,
  onChange: (next: Settings) => void,
): SettingsControls {
  let current: Settings = { charsets: [...initial.charsets], groupCount: initial.groupCount };

  const sets = h('div', 'control-row');
  sets.setAttribute('role', 'group');
  sets.setAttribute('aria-label', 'Character sets for the next drill');

  const pills = new Map<CharsetId, HTMLButtonElement>();
  for (const charset of CHARSETS) {
    const pill = h('button', 'pill', charset.label);
    pill.type = 'button';
    pill.addEventListener('click', () => {
      toggle(charset.id);
    });
    pills.set(charset.id, pill);
    sets.append(pill);
  }

  const lengthLabel = h('label', 'field');
  lengthLabel.append(h('span', 'field__label', 'Groups'));
  const lengthSelect = h('select', 'select');
  for (const count of SESSION_GROUP_COUNTS) {
    const option = h('option', '', String(count));
    option.value = String(count);
    lengthSelect.append(option);
  }
  lengthSelect.addEventListener('change', () => {
    const parsed = Number.parseInt(lengthSelect.value, 10);
    if (Number.isFinite(parsed)) {
      emit({ charsets: current.charsets, groupCount: parsed });
    }
  });
  lengthLabel.append(lengthSelect);

  const element = h('div', 'settings');
  element.append(sets, lengthLabel);

  function toggle(id: CharsetId): void {
    const enabled = current.charsets;
    const isOn = enabled.includes(id);
    if (isOn && enabled.length === 1) {
      // Refused by design: an empty selection cannot produce a drill.
      return;
    }
    const next = isOn ? enabled.filter((entry) => entry !== id) : [...enabled, id];
    emit({ charsets: next, groupCount: current.groupCount });
  }

  function emit(next: Settings): void {
    current = next;
    update(next);
    onChange(next);
  }

  function update(settings: Settings): void {
    current = { charsets: [...settings.charsets], groupCount: settings.groupCount };
    const onlyOneLeft = current.charsets.length === 1;

    for (const [id, pill] of pills) {
      const on = current.charsets.includes(id);
      pill.setAttribute('aria-pressed', String(on));
      pill.className = on ? 'pill is-on' : 'pill';
      // The final active set cannot be switched off, so say so instead of ignoring
      // the click silently.
      pill.disabled = on && onlyOneLeft;
      pill.title = pill.disabled
        ? 'At least one character set has to stay on'
        : `Toggle ${id} for the next drill`;
    }
    lengthSelect.value = String(current.groupCount);
  }

  update(initial);

  return { element, update };
}
