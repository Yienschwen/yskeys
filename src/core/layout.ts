import { CHARSETS } from './charset';

/**
 * US QWERTY physical layout. Two jobs: attribute accuracy to a finger and hand, and
 * answer "is it the symbol or the Shift that is hard" (PROJECT.md §6.5).
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
  | 'r-pinky';

export type Hand = 'left' | 'right';
export type CharKind = 'letter' | 'digit' | 'punctuation' | 'symbol';

export interface KeyInfo {
  readonly char: string;
  /** 1 = number row, 2 = top, 3 = home, 4 = bottom. */
  readonly row: number;
  readonly col: number;
  readonly hand: Hand;
  readonly finger: FingerId;
  readonly shifted: boolean;
  readonly kind: CharKind;
}

interface RowSpec {
  readonly plain: string;
  readonly shifted: string;
  readonly fingers: readonly FingerId[];
}

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
  return finger.startsWith('l-') ? 'left' : 'right';
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

  return layout;
}

/** All 94 printable non-space ASCII characters, keyed by the character itself. */
export const KEY_LAYOUT: ReadonlyMap<string, KeyInfo> = buildLayout();

export function keyInfo(char: string): KeyInfo | null {
  return KEY_LAYOUT.get(char) ?? null;
}
