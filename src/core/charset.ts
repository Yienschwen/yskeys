/**
 * The five character sets offered by the settings row (PROJECT.md F10).
 *
 * Invariants, enforced by src/test/charset.test.ts:
 *   1. every character is printable non-space ASCII (0x21–0x7E)
 *   2. no duplicates inside a set, no character shared between sets
 *   3. together they cover all 94 printable non-space ASCII characters
 */

export type CharsetId = 'lowercase' | 'uppercase' | 'digits' | 'punctuation' | 'symbols';

export interface Charset {
  readonly id: CharsetId;
  /** Short label for the settings pill. */
  readonly label: string;
  readonly chars: string;
  readonly defaultEnabled: boolean;
}

export const CHARSETS: readonly Charset[] = [
  {
    id: 'lowercase',
    label: 'a–z',
    chars: 'abcdefghijklmnopqrstuvwxyz',
    defaultEnabled: true,
  },
  {
    id: 'uppercase',
    label: 'A–Z',
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    defaultEnabled: false,
  },
  {
    id: 'digits',
    label: '0–9',
    chars: '0123456789',
    defaultEnabled: false,
  },
  {
    id: 'punctuation',
    label: 'Punctuation',
    chars: `.,;:'"!?-`,
    defaultEnabled: false,
  },
  {
    id: 'symbols',
    label: 'Symbols',
    chars: "_()[]{}<>+=|/\\@#$%^&*~`",
    defaultEnabled: false,
  },
];

export function getCharset(id: CharsetId): Charset {
  const found = CHARSETS.find((charset) => charset.id === id);
  if (!found) {
    throw new Error(`unknown charset: ${String(id)}`);
  }
  return found;
}

/** Characters to draw from, in the order the caller listed the sets. */
export function charsFor(ids: readonly CharsetId[]): string {
  return ids.map((id) => getCharset(id).chars).join('');
}

export function defaultCharsetIds(): CharsetId[] {
  return CHARSETS.filter((charset) => charset.defaultEnabled).map((charset) => charset.id);
}
