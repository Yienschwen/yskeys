import { CHARSETS } from './charset';

/**
 * US QWERTY physical layout. Three jobs:
 *
 *  1. attribute accuracy to a finger and a hand (PROJECT.md F6/F7),
 *  2. answer "is it the symbol or the Shift that is hard",
 *  3. tell the practice view which finger should press the next key — including for
 *     `\n`, which is a real target in the text/code shape.
 *
 * `kind` follows the charset a character belongs to, so the byKind buckets line up
 * exactly with the settings toggles. That means `?` is punctuation while `/` is a
 * symbol: the split is by charset, not by linguistic intuition.
 */

export type FingerId =
  | 'l-pinky'
  | 'l-ring'
  | 'l-middle'
  | 'l-index'
  | 'r-index'
  | 'r-middle'
  | 'r-ring'
  | 'r-pinky'
  | 'thumb';

export type Hand = 'left' | 'right';
export type CharKind = 'letter' | 'digit' | 'punctuation' | 'symbol' | 'space' | 'control';

export interface KeyInfo {
  readonly char: string;
  /** 1 = number row, 2 = top, 3 = home, 4 = bottom, 5 = space bar. */
  readonly row: number;
  readonly col: number;
  readonly hand: Hand;
  readonly finger: FingerId;
  readonly shifted: boolean;
  readonly kind: CharKind;
}

/** One physical key, with the label drawn on the cap. */
export interface KeyCap {
  /** What the key types when the drill expects it. */
  readonly char: string;
  /** What is printed on the cap; may be two characters (`{` / `[`). */
  readonly legend: string;
  readonly finger: FingerId;
}

/**
 * A visual keyboard row. `keyCaps` are real keys; the remaining columns are gaps, which
 * is what makes the staggered rows line up with a real keyboard.
 */
export interface LayoutRow {
  /** Columns before the first key cap. */
  readonly offset: number;
  readonly keyCaps: readonly KeyCap[];
  /** Total grid columns in the row; defaults to offset + keys. */
  readonly columns?: number;
  readonly space?: boolean;
  readonly enter?: boolean;
}

interface RowSpec {
  readonly plain: string;
  readonly shifted: string;
  readonly fingers: readonly FingerId[];
}

/** The four alphanumeric rows, left to right. */
const ROWS: readonly RowSpec[] = [
  {
    plain: '`1234567890-=',
    shifted: '~!@#$%^&*()_+',
    fingers: [
      'l-pinky', 'l-pinky', 'l-ring', 'l-middle', 'l-index', 'l-index', 'r-index',
      'r-index', 'r-middle', 'r-ring', 'r-pinky', 'r-pinky', 'r-pinky',
    ],
  },
  {
    plain: 'qwertyuiop[]\\',
    shifted: 'QWERTYUIOP{}|',
    fingers: [
      'l-pinky', 'l-ring', 'l-middle', 'l-index', 'l-index', 'r-index', 'r-index',
      'r-middle', 'r-ring', 'r-pinky', 'r-pinky', 'r-pinky', 'r-pinky',
    ],
  },
  {
    plain: "asdfghjkl;'",
    shifted: 'ASDFGHJKL:"',
    fingers: [
      'l-pinky', 'l-ring', 'l-middle', 'l-index', 'l-index', 'r-index', 'r-index',
      'r-middle', 'r-ring', 'r-pinky', 'r-pinky',
    ],
  },
  {
    plain: 'zxcvbnm,./',
    shifted: 'ZXCVBNM<>?',
    fingers: [
      'l-pinky', 'l-ring', 'l-middle', 'l-index', 'l-index', 'r-index', 'r-index',
      'r-middle', 'r-ring', 'r-pinky',
    ],
  },
];

function handOf(finger: FingerId): Hand {
  return finger === 'thumb' || finger.startsWith('l-') ? 'left' : 'right';
}

function kindOf(char: string): CharKind {
  for (const charset of CHARSETS) {
    if (!charset.chars.includes(char)) {
      continue;
    }
    switch (charset.id) {
      case 'lowercase':
      case 'uppercase':
        return 'letter';
      case 'digits':
        return 'digit';
      case 'punctuation':
        return 'punctuation';
      case 'symbols':
        return 'symbol';
    }
  }
  // Built at module load, so an unmapped character fails immediately and loudly
  // rather than silently dropping samples out of the per-finger counts.
  throw new Error(`no charset contains ${JSON.stringify(char)}`);
}

/**
 * The keys a drill can expect that are not printable ASCII. They are never part of a
 * charset — those are the selectable *characters* — but the text/code shape types real
 * lines, so the newline is a real target with a real finger.
 */
const NEWLINE_KEY_INFO: KeyInfo = {
  char: '\n',
  row: 3,
  col: 13,
  hand: 'right',
  finger: 'r-pinky',
  shifted: false,
  kind: 'control',
};

const TAB_KEY_INFO: KeyInfo = {
  char: '\t',
  row: 2,
  col: -1,
  hand: 'left',
  finger: 'l-pinky',
  shifted: false,
  kind: 'control',
};

/**
 * The space bar. It is not part of any charset — those are the selectable drill
 * characters — but it separates chunks in every drill, so it is a real target and gets
 * a real record. `hand` is a convention: the space bar is pressed by a thumb, and the
 * left thumb is as common as the right, but the finger table is where that belongs.
 */
const SPACE_KEY: KeyInfo = {
  char: ' ',
  row: 5,
  col: 4,
  hand: 'right',
  finger: 'thumb',
  shifted: false,
  kind: 'space',
};

function buildLayout(): ReadonlyMap<string, KeyInfo> {
  const layout = new Map<string, KeyInfo>();

  ROWS.forEach((row, rowIndex) => {
    if (row.shifted.length !== row.plain.length || row.fingers.length !== row.plain.length) {
      throw new Error(`layout row ${String(rowIndex + 1)} is not rectangular`);
    }
    for (let col = 0; col < row.plain.length; col += 1) {
      const finger = row.fingers[col];
      if (finger === undefined) {
        throw new Error(`layout row ${String(rowIndex + 1)} is missing finger ${String(col)}`);
      }
      const hand = handOf(finger);
      const plain = row.plain.charAt(col);
      const shifted = row.shifted.charAt(col);
      layout.set(plain, {
        char: plain,
        row: rowIndex + 1,
        col,
        hand,
        finger,
        shifted: false,
        kind: kindOf(plain),
      });
      layout.set(shifted, {
        char: shifted,
        row: rowIndex + 1,
        col,
        hand,
        finger,
        shifted: true,
        kind: kindOf(shifted),
      });
    }
  });

  layout.set(' ', SPACE_KEY);
  layout.set('\n', NEWLINE_KEY_INFO);
  layout.set('\t', TAB_KEY_INFO);

  return layout;
}

/** All 97 keys: the 94 printable non-space characters, space, newline and tab. */
export const KEY_LAYOUT: ReadonlyMap<string, KeyInfo> = buildLayout();

export function keyInfo(char: string): KeyInfo | null {
  return KEY_LAYOUT.get(char) ?? null;
}

/* ------------------------------------------------------------------ fingers -- */

/** Human name per finger, used in the hint text and in the diagram legend. */
export const FINGER_LABELS: Readonly<Record<FingerId, string>> = {
  'l-pinky': 'left little finger',
  'l-ring': 'left ring finger',
  'l-middle': 'left middle finger',
  'l-index': 'left index finger',
  'r-index': 'right index finger',
  'r-middle': 'right middle finger',
  'r-ring': 'right ring finger',
  'r-pinky': 'right little finger',
  thumb: 'thumb',
};

/** A stable CSS-friendly class suffix per finger (`l-pinky` → `is-l-pinky`). */
export function fingerClass(finger: FingerId): string {
  return `is-${finger}`;
}

/**
 * Layout rows for the finger diagram: the four alphanumeric rows plus a space-bar row.
 * The UI adds the Enter cap to the right end of the home row, because that is where it
 * is on a real keyboard.
 */
export const DIAGRAM_ROWS: readonly LayoutRow[] = [
  ...ROWS.map((row, rowIndex) => ({
    offset: rowIndex === 3 ? 1 : rowIndex === 2 ? 0.5 : 0,
    keyCaps: [...row.plain].map((char, col) => ({
      char,
      legend: char,
      finger: row.fingers[col] ?? 'l-pinky',
    })),
    columns: 15,
  })),
  { offset: 0, keyCaps: [], columns: 15, space: true, enter: true },
];

/**
 * The finger hint for a target character. `char` is what is expected; the finger comes
 * from the physical layout, so Shift'd characters name the finger that reaches for
 * them, not the Shift key.
 */
export interface FingerHint {
  readonly char: string;
  readonly label: string;
  readonly finger: FingerId;
  readonly hand: Hand;
  readonly shifted: boolean;
}

export function fingerHintFor(char: string): FingerHint | null {
  const info = keyInfo(char);
  if (!info) {
    return null;
  }
  return {
    char,
    label: FINGER_LABELS[info.finger],
    finger: info.finger,
    hand: info.hand,
    shifted: info.shifted,
  };
}
