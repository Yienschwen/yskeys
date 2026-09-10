import { SESSION_GROUP_COUNTS } from '../config';
import { CHARSETS } from '../core/charset';
import type { CharsetId } from '../core/charset';
import type { DrillShape } from '../core/generator';
import { preferredShape } from '../store/schema';
import type { Settings } from '../store/schema';
import { h } from './dom';

/**
 * The settings row (PROJECT.md F10). Changes apply to the next drill, never to a
 * session already in flight, and turning off the last character set is prevented here
 * rather than being rejected somewhere downstream.
 *
 * The shape control only appears meaningful once a word list exists, so its "Words"
 * option is disabled with a reason when it cannot be honoured.
 */

export interface SettingsControls {
  readonly element: HTMLElement;
  update(settings: Settings): void;
  setWordsState(available: boolean, hint: string): void;
}

const SHAPES: ReadonlyArray<readonly [DrillShape, string]> = [
  ['words', 'Words'],
  ['uniform', 'Characters'],
];

export function createSettingsControls(
  initial: Settings,
  onChange: (next: Settings) => void,
  options: { wordsAvailable: boolean; wordsHint: string },
): SettingsControls {
  let current: Settings = { ...initial, charsets: [...initial.charsets] };
  let wordsAvailable = options.wordsAvailable;
  let wordsHint = options.wordsHint;

  const sets = h('div', 'control-row');
  sets.setAttribute('role', 'group');
  sets.setAttribute('aria-label', 'Character sets for the next drill');

  const pills = new Map<CharsetId, HTMLButtonElement>();
  for (const charset of CHARSETS) {
    const pill = h('button', 'pill', charset.label);
    pill.type = 'button';
    pill.addEventListener('click', () => {
      toggleCharset(charset.id);
    });
    pills.set(charset.id, pill);
    sets.append(pill);
  }

  const shapeGroup = h('div', 'segmented');
  shapeGroup.setAttribute('role', 'group');
  shapeGroup.setAttribute('aria-label', 'Drill shape');
  const shapeButtons = new Map<DrillShape, HTMLButtonElement>();
  for (const [shape, label] of SHAPES) {
    const button = h('button', 'segment', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (shape === 'words' && !wordsAvailable) {
        return;
      }
      emit({ ...current, shape });
    });
    shapeButtons.set(shape, button);
    shapeGroup.append(button);
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
      emit({ ...current, groupCount: parsed });
    }
  });
  lengthLabel.append(lengthSelect);

  const shapeHint = h('span', 'settings__hint');

  const element = h('div', 'settings');
  element.append(sets, shapeGroup, lengthLabel, shapeHint);

  function toggleCharset(id: CharsetId): void {
    const enabled = current.charsets;
    const isOn = enabled.includes(id);
    if (isOn && enabled.length === 1) {
      // Refused by design: an empty selection cannot produce a drill.
      return;
    }
    const next = isOn ? enabled.filter((entry) => entry !== id) : [...enabled, id];
    emit({ ...current, charsets: next });
  }

  function emit(next: Settings): void {
    update(next);
    onChange(next);
  }

  function update(settings: Settings): void {
    current = { ...settings, charsets: [...settings.charsets] };
    const onlyOneLeft = current.charsets.length === 1;

    for (const [id, pill] of pills) {
      const on = current.charsets.includes(id);
      pill.setAttribute('aria-pressed', String(on));
      pill.className = on ? 'pill is-on' : 'pill';
      pill.disabled = on && onlyOneLeft;
      pill.title = pill.disabled
        ? 'At least one character set has to stay on'
        : `Toggle ${id} for the next drill`;
    }

    const shape = preferredShape(current);
    for (const [key, button] of shapeButtons) {
      const on = key === shape;
      button.setAttribute('aria-pressed', String(on));
      button.className = on ? 'segment is-on' : 'segment';
    }
    applyWordsState();

    lengthSelect.value = String(current.groupCount);
  }

  function applyWordsState(): void {
    const words = shapeButtons.get('words');
    if (words) {
      words.disabled = !wordsAvailable;
      words.title = wordsAvailable
        ? 'Practise real words from the list you imported'
        : wordsHint;
    }
    shapeHint.textContent = wordsAvailable ? '' : wordsHint;
    shapeHint.hidden = wordsAvailable;
  }

  function setWordsState(available: boolean, hint: string): void {
    wordsAvailable = available;
    wordsHint = hint;
    applyWordsState();
  }

  update(initial);

  return { element, update, setWordsState };
}
