import { MAX_WORDLIST_CHARS, WORD_MAX_LENGTH, WORD_MIN_LENGTH } from '../config';

/**
 * Word list parsing. Every public list has its own quirks, so the parser is tolerant
 * about the container (dice numbers, comments, BOM, CRLF) and strict about the words
 * themselves — and it always reports what it threw away. Silently dropping lines is
 * how you end up wondering why your list looks shorter than the file.
 */

export interface ParsedWordList {
  readonly words: string[];
  readonly kept: number;
  /** Lines that looked like candidates but were not usable as a word. */
  readonly skipped: number;
  readonly duplicates: number;
}

export type ParseWordListResult =
  | { ok: true; list: ParsedWordList }
  | { ok: false; reason: string };

/** Printable non-space ASCII: the only characters a drill can contain. */
const PRINTABLE = /^[\x21-\x7e]+$/;

export function parseWordList(
  text: string,
  options: { maxChars?: number } = {},
): ParseWordListResult {
  const maxChars = options.maxChars ?? MAX_WORDLIST_CHARS;
  if (text.length > maxChars) {
    return {
      ok: false,
      reason: `the file is too large (${String(text.length)} characters; the limit is ${String(maxChars)})`,
    };
  }

  const seen = new Set<string>();
  const words: string[] = [];
  let skipped = 0;
  let duplicates = 0;

  for (const rawLine of stripBom(text).split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const candidate = extractCandidate(line);
    if (
      candidate === '' ||
      !PRINTABLE.test(candidate) ||
      candidate.length < WORD_MIN_LENGTH ||
      candidate.length > WORD_MAX_LENGTH
    ) {
      skipped += 1;
      continue;
    }
    if (seen.has(candidate)) {
      duplicates += 1;
      continue;
    }
    seen.add(candidate);
    words.push(candidate);
  }

  if (words.length === 0) {
    return { ok: false, reason: 'no usable words were found in that file' };
  }
  return { ok: true, list: { words, kept: words.length, skipped, duplicates } };
}

/**
 * Handles the shapes these files actually come in: EFF's `24255\tword`, an
 * index-then-word line, or a bare word per line. A word with internal whitespace is
 * not a word, so it is left to fail validation rather than being silently split.
 */
function extractCandidate(line: string): string {
  const tabbed = line.split('\t');
  const tail = tabbed.length > 1 ? (tabbed[tabbed.length - 1] ?? '') : line;
  return tail.replace(/^\d+\s+/, '').trim();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
