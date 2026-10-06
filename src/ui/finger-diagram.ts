import { DIAGRAM_ROWS, FINGER_LABELS, KEY_LAYOUT, fingerClass, fingerHintFor } from '../core/layout';
import type { FingerHint, FingerId } from '../core/layout';
import { h } from './dom';

/**
 * The finger hint (PROJECT.md F13): which finger presses the next key, as a sentence
 * and as a picture. The picture is a US QWERTY diagram drawn with CSS grid, where every
 * key is tinted by the finger that owns it and the next key is marked twice — filled
 * with its finger's colour *and* struck through with a boundary — so the answer does
 * not depend on distinguishing two similar tints.
 *
 * This is a hint, not a measurement: it reads the same layout table that attributes the
 * accuracy, so the two can never disagree about which finger owns a key.
 */

export interface FingerDiagram {
  readonly element: HTMLElement;
  /** `null` means "nothing to hint": the drill is finished, or the character is unknown. */
  render(char: string | null): void;
}

export function createFingerDiagram(): FingerDiagram {
  const root = h('section', 'finger');
  const label = h('p', 'finger__label');
  const detail = h('p', 'finger__detail');
  /**
   * Every character that lands on a key cap. A cap is drawn once for its plain
   * character, and the shifted character above it resolves to the same element, so
   * `{` lights up the `[` key exactly as `[` does.
   */
  const keys = new Map<string, HTMLElement>();
  const rows: Array<{ element: HTMLElement; key: Map<string, HTMLElement> }> = [];

  for (const row of DIAGRAM_ROWS) {
    const rowElement = h('div', 'finger__row');
    rowElement.style.gridTemplateColumns = `repeat(${String(row.columns ?? 15)}, 1fr)`;
    if (row.offset > 0) {
      const spacer = h('span', 'finger__spacer');
      spacer.style.gridColumn = `span ${String(row.offset)}`;
      rowElement.append(spacer);
    }
    const key = new Map<string, HTMLElement>();
    for (const cap of row.keyCaps) {
      const keyElement = h('span', `finger__key ${fingerClass(cap.finger)}`, cap.legend);
      keyElement.dataset['char'] = cap.char;
      keyElement.dataset['finger'] = cap.finger;
      keyElement.title = `key ${cap.legend} — ${FINGER_LABELS[cap.finger]}`;
      key.set(cap.char, keyElement);
      for (const char of capChars(cap.char)) {
        keys.set(char, keyElement);
      }
      rowElement.append(keyElement);
    }
    if (row.space === true) {
      const space = h('span', 'finger__key finger__key--wide is-thumb', 'space');
      space.style.gridColumn = '5 / span 6';
      space.dataset['char'] = ' ';
      space.dataset['finger'] = 'thumb';
      key.set(' ', space);
      keys.set(' ', space);
      rowElement.append(space);
    }
    if (row.space === true) {
      // Enter lives at the right end of the home row, above the space bar, so the
      // space row has nothing but the space bar in it.
      const home = rows[3];
      if (home !== undefined) {
        const enter = h('span', 'finger__key finger__key--wide is-r-pinky', '⏎');
        enter.style.gridColumn = '13 / span 2';
        enter.dataset['char'] = '\n';
        enter.dataset['finger'] = 'r-pinky';
        home.key.set('\n', enter);
        home.element.append(enter);
        keys.set('\n', enter);
      }
    }
    rows.push({ element: rowElement, key });
  }

  const keyboard = h('div', 'finger__keyboard');
  keyboard.setAttribute('aria-hidden', 'true');
  for (const row of rows) {
    keyboard.append(row.element);
  }

  const reading = h('div', 'finger__reading');
  reading.append(label, detail);
  root.append(reading, keyboard);

  const fingerNames = new Map<FingerId, string>();
  for (const [finger, name] of Object.entries(FINGER_LABELS) as Array<[FingerId, string]>) {
    fingerNames.set(finger, name);
  }

  function render(char: string | null): void {
    const hint: FingerHint | null = char === null ? null : fingerHintFor(char);
    for (const row of rows) {
      for (const keyElement of row.key.values()) {
        keyElement.classList.remove('is-next');
      }
    }

    if (hint === null) {
      label.textContent = char === null ? 'Done' : 'No key for that character';
      detail.textContent =
        char === null
          ? 'Start the next drill to see which finger to use.'
          : 'That character is not on a US QWERTY layout.';
      root.dataset['finger'] = 'none';
      root.hidden = char === null;
      return;
    }

    root.hidden = false;
    keys.get(hint.char)?.classList.add('is-next');
    root.dataset['finger'] = hint.finger;
    label.textContent = `Next: ${describeKey(hint.char)} → ${hint.label}`;
    detail.textContent = hint.shifted
      ? `Hold Shift with the ${hint.hand === 'left' ? 'right' : 'left'} little finger and reach with the ${hint.label}.`
      : `Reach with the ${hint.label}.`;
  }

  render(null);
  return { element: root, render };
}

/** The plain character a cap shows, plus every shifted character on the same key. */
function capChars(plain: string): string[] {
  const info = KEY_LAYOUT.get(plain);
  if (info === undefined) {
    return [plain];
  }
  const chars = [plain];
  for (const [char, other] of KEY_LAYOUT) {
    if (other.row === info.row && other.col === info.col) {
      chars.push(char);
    }
  }
  return chars;
}

/** A space and a newline need words; everything else shows itself. */
export function describeKey(char: string): string {
  if (char === ' ') {
    return 'space';
  }
  if (char === '\n') {
    return 'Enter ⏎';
  }
  if (char === '\t') {
    return 'Tab';
  }
  return char;
}
