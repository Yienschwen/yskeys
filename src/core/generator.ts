import { CAPITALIZE_PROBABILITY, MIN_USABLE_WORDS, WORD_MAX_LENGTH, WORD_MIN_LENGTH } from '../config';
import { charsFor, getCharset } from './charset';
import type { CharsetId } from './charset';
import { createRng, randomInt } from './random';
import type { Rng } from './random';

/**
 * Drill generation. Two shapes: real words from a list the user imported, and the
 * uniform character groups that M1 shipped. M3 adds weighted sampling on top; both
 * shapes keep the same `Drill` contract, so nothing downstream cares.
 */

export type DrillShape = 'words' | 'uniform';

export interface SessionSpec {
  readonly charsets: readonly CharsetId[];
  readonly groupCount: number;
  readonly groupSize: number;
  readonly seed: number;
}

export interface Drill {
  /**
   * Groups are the unit of display and of line wrapping (DESIGN.md §2.3). They are
   * separated by a real space in `text`, which is typed and counted like any other
   * character — the gap between groups is not decoration.
   */
  readonly groups: readonly string[];
  readonly text: string;
}

export function buildUniformDrill(spec: SessionSpec): Drill {
  const pool = charsFor(spec.charsets);
  if (pool.length === 0) {
    throw new Error('cannot build a drill from an empty charset selection');
  }
  if (!Number.isInteger(spec.groupCount) || spec.groupCount <= 0) {
    throw new Error(`groupCount must be a positive integer, got ${String(spec.groupCount)}`);
  }
  if (!Number.isInteger(spec.groupSize) || spec.groupSize <= 0) {
    throw new Error(`groupSize must be a positive integer, got ${String(spec.groupSize)}`);
  }

  const rng = createRng(spec.seed);
  const groups: string[] = [];
  let previous = '';

  for (let groupIndex = 0; groupIndex < spec.groupCount; groupIndex += 1) {
    let group = '';
    for (let charIndex = 0; charIndex < spec.groupSize; charIndex += 1) {
      const char = pickDifferent(pool, previous, rng);
      group += char;
      previous = char;
    }
    groups.push(group);
  }

  return { groups, text: groups.join(' ') };
}

/**
 * Draws a character that differs from the previous one. With a single-character
 * pool an adjacent repeat is unavoidable, so the fallback accepts it rather than
 * looping forever.
 */
function pickDifferent(pool: string, avoid: string, rng: Rng): string {
  const maxAttempts = 16;
  let candidate = avoid;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    candidate = pool.charAt(randomInt(rng, pool.length));
    if (candidate !== avoid) {
      return candidate;
    }
  }
  return candidate;
}

/* ---------------------------------------------------------------- words -- */

export interface WordDrillSpec {
  readonly charsets: readonly CharsetId[];
  /** Non-space characters to reach, so sessions stay comparable across shapes. */
  readonly targetChars: number;
  readonly words: readonly string[];
  readonly seed: number;
}

/** Letters the enabled charsets can produce, case-folded. */
function allowedLetters(charsets: readonly CharsetId[]): Set<string> {
  const letters = new Set<string>();
  for (const id of charsets) {
    for (const char of getCharset(id).chars) {
      const lower = char.toLowerCase();
      if (lower >= 'a' && lower <= 'z') {
        letters.add(lower);
      }
    }
  }
  return letters;
}

/**
 * Filters a list down to what the current charsets can actually type. Done at
 * session build time rather than at import time, because the charsets can change
 * after the import.
 */
export function usableWords(
  words: readonly string[],
  charsets: readonly CharsetId[],
): string[] {
  const letters = allowedLetters(charsets);
  if (letters.size === 0) {
    return [];
  }
  return words.filter((word) => {
    if (word.length < WORD_MIN_LENGTH || word.length > WORD_MAX_LENGTH) {
      return false;
    }
    return [...word].every((char) => letters.has(char.toLowerCase()));
  });
}

export function isWordListUsable(words: readonly string[], charsets: readonly CharsetId[]): boolean {
  return usableWords(words, charsets).length >= MIN_USABLE_WORDS;
}

export function buildWordDrill(spec: WordDrillSpec): Drill {
  const pool = usableWords(spec.words, spec.charsets);
  const first = pool[0];
  if (first === undefined) {
    throw new Error('cannot build a word drill without usable words');
  }

  const mode = caseModeFor(spec.charsets);
  const rng = createRng(spec.seed);
  const target = Math.max(1, Math.floor(spec.targetChars));
  const groups: string[] = [];
  let chars = 0;
  let previous = '';

  // The cap guards against a pathological loop if the target far exceeds the pool.
  const maxWords = target + 100;
  while (chars < target && groups.length < maxWords) {
    const word = pickWord(pool, previous, rng);
    previous = word;
    const text = applyCase(word, mode, rng);
    groups.push(text);
    chars += text.length;
  }

  return { groups, text: groups.join(' ') };
}

type CaseMode = 'lower' | 'upper' | 'title-sometimes';

function caseModeFor(charsets: readonly CharsetId[]): CaseMode {
  const lower = charsets.includes('lowercase');
  const upper = charsets.includes('uppercase');
  if (upper && lower) {
    return 'title-sometimes';
  }
  return upper ? 'upper' : 'lower';
}

/**
 * With both cases enabled, some words are title-cased: that trains Shift in a real
 * context instead of in a random one. Capitalising a random letter mid-word is not a
 * thing real text does, so it is not offered.
 */
function applyCase(word: string, mode: CaseMode, rng: Rng): string {
  switch (mode) {
    case 'upper':
      return word.toUpperCase();
    case 'lower':
      return word.toLowerCase();
    case 'title-sometimes':
      return rng() < CAPITALIZE_PROBABILITY
        ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        : word.toLowerCase();
  }
}

function pickWord(pool: readonly string[], avoid: string, rng: Rng): string {
  const fallback = pool[0];
  if (fallback === undefined) {
    throw new Error('empty word pool');
  }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = pool[randomInt(rng, pool.length)];
    if (candidate !== undefined && candidate !== avoid) {
      return candidate;
    }
  }
  return fallback;
}
