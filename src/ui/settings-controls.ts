import { SESSION_GROUP_COUNTS } from '../config';
import { CHARSETS } from '../core/charset';
import type { CharsetId } from '../core/charset';
import { DRILL_SHAPES } from '../core/generator';
import type { DrillShape } from '../core/generator';
import {
  preferredNextKey,
  preferredShape,
  preferredSpaceDisplay,
  SPACE_DISPLAY_LABELS,
  SPACE_DISPLAYS,
} from '../store/schema';
import type { Settings } from '../store/schema';
import { h } from './dom';

/**
 * The settings row (PROJECT.md F10). Changes apply to the next drill, never to a
 * session already in flight, and turning off the last character set is prevented here
 * rather than being rejected somewhere downstream.
 *
 * Four controls, each a segmented group of real buttons:
 *  - character sets (pills) — what may be practised,
 *  - drill shape — words / text / patterns,
 *  - space marker — how the space target is drawn,
 *  - next key — whether the finger hint is shown.
 *
 * A shape whose material is missing is disabled with the actual reason rather than
 * silently ignored.
 */

export interface SettingsControls {
  readonly element: HTMLElement;
  update(settings: Settings): void;
  setShapeState(shape: DrillShape, available: boolean, hint: string): void;
}

export interface ShapeAvailability {
  readonly available: boolean;
  readonly hint: string;
}

export interface SettingsOptions {
  /** Per-shape availability, with the reason when it cannot be honoured. */
  readonly shapes: Readonly<Record<DrillShape, ShapeAvailability>>;
}

const SHAPE_LABELS: Readonly<Record<DrillShape, string>> = {
  words: 'Words',
  text: 'Text / code',
  patterns: 'Patterns',
};

const SHAPE_TITLES: Readonly<Record<DrillShape, string>> = {
  words: 'Practise real words from the list you imported',
  text: 'Practise your own text or code, line by line',
  patterns: 'Random character groups from the enabled sets',
};

export function createSettingsControls(
  initial: Settings,
  onChange: (next: Settings) => void,
  options: SettingsOptions,
): SettingsControls {
  let current: Settings = { ...initial, charsets: [...initial.charsets] };
  const shapeState = new Map<DrillShape, ShapeAvailability>();
  for (const shape of DRILL_SHAPES) {
    shapeState.set(shape, options.shapes[shape] ?? { available: true, hint: '' });
  }

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

  const shapeGroup = segmentedStrings('Drill shape', DRILL_SHAPES, SHAPE_LABELS, (shape) => {
    if (!isShapeAvailable(shape)) {
      return;
    }
    emit({ ...current, shape });
  });
  const shapeButtons = shapeGroup.buttons;

  const spaceGroup = segmentedStrings(
    'How the space target is drawn',
    SPACE_DISPLAYS,
    SPACE_DISPLAY_LABELS,
    (spaceDisplay) => {
      emit({ ...current, spaceDisplay });
    },
  );

  const nextKeyGroup = segmentedStrings(
    'Next-key finger hint',
    ['shown', 'hidden'] as const,
    { shown: 'Finger hint', hidden: 'Hidden' },
    (value) => {
      emit({ ...current, nextKey: value === 'shown' });
    },
  );

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
  element.dataset['interactive'] = 'true';
  element.append(
    sets,
    shapeGroup.element,
    spaceGroup.element,
    nextKeyGroup.element,
    lengthLabel,
    shapeHint,
  );

  function isShapeAvailable(shape: DrillShape): boolean {
    return shapeState.get(shape)?.available ?? true;
  }

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

  function applyClass(button: HTMLButtonElement, on: boolean): void {
    button.setAttribute('aria-pressed', String(on));
    button.className = on ? 'segment is-on' : 'segment';
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
      applyClass(button, key === shape);
    }
    applyShapeState();

    const spaceDisplay = preferredSpaceDisplay(current);
    for (const [key, button] of spaceGroup.buttons) {
      applyClass(button, key === spaceDisplay);
    }

    const nextKey = preferredNextKey(current) ? 'shown' : 'hidden';
    for (const [key, button] of nextKeyGroup.buttons) {
      applyClass(button, key === nextKey);
    }

    lengthSelect.value = String(current.groupCount);
  }

  function applyShapeState(): void {
    const shape = preferredShape(current);
    let hint = '';
    for (const [key, button] of shapeButtons) {
      const state = shapeState.get(key) ?? { available: true, hint: '' };
      button.disabled = !state.available;
      button.title = state.available ? SHAPE_TITLES[key] : state.hint;
      if (!state.available && key === shape) {
        hint = state.hint;
      }
    }
    // An unavailable shape may still be the selected one — the drill then falls back,
    // and the hint is the only place that says so.
    shapeHint.textContent = hint;
    shapeHint.hidden = hint === '';
  }

  function setShapeState(shape: DrillShape, available: boolean, hint: string): void {
    shapeState.set(shape, { available, hint });
    applyShapeState();
  }

  update(initial);

  return { element, update, setShapeState };
}

interface SegmentedGroup<K extends string> {
  readonly element: HTMLElement;
  readonly buttons: Map<K, HTMLButtonElement>;
}

function segmentedStrings<K extends string>(
  ariaLabel: string,
  values: readonly K[],
  labels: Readonly<Record<K, string>>,
  onPick: (value: K) => void,
): SegmentedGroup<K> {
  const element = h('div', 'segmented');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', ariaLabel);
  const buttons = new Map<K, HTMLButtonElement>();
  for (const value of values) {
    const button = h('button', 'segment', labels[value]);
    button.type = 'button';
    button.addEventListener('click', () => {
      onPick(value);
    });
    buttons.set(value, button);
    element.append(button);
  }
  return { element, buttons };
}
