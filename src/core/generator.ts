import {
  CAPITALIZE_PROBABILITY,
  EMBED_PROBABILITY,
  MIN_USABLE_WORDS,
  WORD_MAX_LENGTH,
  WORD_MIN_LENGTH,
} from '../config';
import { buildCandidates, sampleCandidate } from './adaptive';
import type { AdaptiveSource } from './adaptive';
import { charsFor, getCharset } from './charset';
import type { CharsetId } from './charset';
import { createRng, randomInt } from './random';
import type { Rng } from './random';

/**
 * Drill generation. Three shapes share one contract (`Drill`), so nothing downstream
 * cares which one produced the target:
 *
 *  - **words** — every chunk is a real word from the list the user imported,
 *  - **text** — every chunk is a run of characters from the user's own text or code,
 *    with newlines kept as their own chunks so the source's line structure survives,
 *  - **patterns** — random character groups from the enabled character sets.
 *
 * In adaptive mode a unit is drawn by weakness and then *materialized* into a chunk of
 * the chosen shape. In uniform mode the pattern/word generators run without weighting,
 * which is the control that shows whether the adaptive part does anything at all.
 */

export type DrillShape = 'words' | 'text' | 'patterns';

export const DRILL_SHAPES: readonly DrillShape[] = ['words', 'text', 'patterns'];

/**
 * Raised when the chosen shape cannot produce anything (an empty word pool, an empty
 * text source, an empty list). The caller falls back to another shape rather than
 * refusing to start a session.
 */
export class EmptyDrillSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmptyDrillSourceError';
  }
}

export interface Drill {
  /**
   * The units of display and of line wrapping (DESIGN.md §2.3). In the words shape they
   * are separated by a real space in `text`; in the text shape the source supplies its
   * own separators. Either way the gap is not decoration.
   */
  readonly groups: readonly string[];
  /** The exact string to type, character for character. */
  readonly text: string;
  /** What the caller should join `groups` with, for rendering. */
  readonly separator: string;
  /** Chunks that are a line break rather than content. */
  readonly lineBreaks: number;
}

export interface SessionSpec {
  readonly charsets: readonly CharsetId[];
  readonly groupCount: number;
  readonly groupSize: number;
  readonly seed: number;
}

export function buildUniformDrill(spec: SessionSpec): Drill {
  const pool = charsFor(spec.charsets);
  if (pool.length === 0) {
    throw new EmptyDrillSourceError('cannot build a drill from an empty charset selection');
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

  return { groups, text: groups.join(' '), separator: ' ', lineBreaks: 0 };
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

/* ------------------------------------------------------------------ word list -- */

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
  if (pool.length === 0) {
    throw new EmptyDrillSourceError('cannot build a word drill without usable words');
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

  return { groups, text: groups.join(' '), separator: ' ', lineBreaks: 0 };
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
    throw new EmptyDrillSourceError('empty word pool');
  }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = pool[randomInt(rng, pool.length)];
    if (candidate !== undefined && candidate !== avoid) {
      return candidate;
    }
  }
  return fallback;
}

/* -------------------------------------------------------------------- indexing -- */

/**
 * Maps every character, and every adjacent pair, in the chunks to the chunks containing
 * them. One pass over the source, and from then on "give me a chunk with `q` in it" is a
 * lookup — which is the only way a rare key is ever practised, given that only 99 of
 * EFF's 7776 words contain a `q`.
 *
 * Only single characters are ever *drawn* (a pair would re-count the same keystroke as
 * evidence), but pairs are indexed all the same: it costs one pass here and it is what
 * makes "does any chunk contain this run" a lookup rather than a scan.
 */
export function buildUnitIndex(chunks: readonly string[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  chunks.forEach((chunk, chunkIndex) => {
    for (let position = 0; position < chunk.length; position += 1) {
      addToIndex(index, chunk.charAt(position), chunkIndex);
      if (position + 2 <= chunk.length) {
        addToIndex(index, chunk.slice(position, position + 2), chunkIndex);
      }
    }
  });
  return index;
}

/** Contents are walked in order, so a repeated unit inside one chunk is the tail. */
function addToIndex(index: Map<string, number[]>, unit: string, chunkIndex: number): void {
  const list = index.get(unit);
  if (list === undefined) {
    index.set(unit, [chunkIndex]);
    return;
  }
  if (list[list.length - 1] !== chunkIndex) {
    list.push(chunkIndex);
  }
}

/* ---------------------------------------------------------------- adaptive drill -- */

export interface MaterializeContext {
  readonly shape: DrillShape;
  readonly charsets: readonly CharsetId[];
  /** Word list for the words shape; ignored by the others. */
  readonly words: readonly string[];
  /** Pre-built chunks for the text shape, in source order. */
  readonly sourceChunks: readonly string[];
  readonly index: ReadonlyMap<string, readonly number[]>;
  readonly rng: Rng;
}

/**
 * Turns a drawn unit into actual drill text.
 *
 * In the words and text shapes the unit is guaranteed to appear, which is the whole
 * point of drawing it by weakness.
 */
export function materializeUnit(
  unit: string,
  context: MaterializeContext,
  avoidText?: string,
): string {
  if (context.shape === 'patterns') {
    return embedUnit(unit, context.charsets, context.rng);
  }
  const pool = context.shape === 'text' ? context.sourceChunks : context.words;
  const chunk = chunkForUnit(context.index.get(unit), pool, context.rng, avoidText);
  if (chunk !== null) {
    return context.shape === 'text' ? chunk : applyWordCase(chunk, context, avoidText);
  }
  return randomChunk(pool, context.rng, avoidText) ?? unit;
}

/**
 * Words are cased at materialization time so a drawn unit is still found in the
 * lowercase list. The text shape is passed through untouched: its case is the point.
 */
function applyWordCase(word: string, context: MaterializeContext, avoidText?: string): string {
  const mode = caseModeFor(context.charsets);
  // Re-drawing a word that differs only by case would look like a repeat, so a cased
  // word that matches the previous chunk falls back to the plain one.
  const cased = applyCase(word, mode, context.rng);
  return cased === avoidText ? word : cased;
}

/**
 * Filler is only ever added before or after the unit, never inside it: splitting a pair
 * would mean the drill no longer contains the thing that was drawn.
 */
export function embedUnit(unit: string, charsets: readonly CharsetId[], rng: Rng): string {
  if (rng() >= EMBED_PROBABILITY) {
    return unit;
  }
  const pool = charsFor(charsets);
  if (pool.length === 0) {
    return unit;
  }
  // Target a 3-5 character group whatever the unit's own length, so an adaptive
  // character drill is not a stream of one- and two-character fragments.
  const groupLength = 3 + randomInt(rng, 3);
  let extra = Math.max(0, groupLength - unit.length);
  let before = '';
  let after = '';
  while (extra > 0) {
    const filler = pool.charAt(randomInt(rng, pool.length));
    if (rng() < 0.5) {
      before += filler;
    } else {
      after += filler;
    }
    extra -= 1;
  }
  return before + unit + after;
}

function chunkForUnit(
  list: readonly number[] | undefined,
  pool: readonly string[],
  rng: Rng,
  avoidText?: string,
): string | null {
  if (list === undefined || list.length === 0) {
    return null;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const index = list[randomInt(rng, list.length)];
    const chunk = index === undefined ? undefined : pool[index];
    if (chunk !== undefined && chunk !== avoidText && chunk !== '\n') {
      return chunk;
    }
  }
  const first = list[0];
  return first === undefined ? null : (pool[first] ?? null);
}

function randomChunk(
  pool: readonly string[],
  rng: Rng,
  avoidText?: string,
): string | null {
  const usable = pool.filter((chunk) => chunk !== '\n');
  if (usable.length === 0) {
    return null;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const chunk = usable[randomInt(rng, usable.length)];
    if (chunk !== undefined && chunk !== avoidText) {
      return chunk;
    }
  }
  return usable[0] ?? null;
}

export interface DrillSpec {
  readonly shape: DrillShape;
  readonly charsets: readonly CharsetId[];
  /** Non-space characters to reach. */
  readonly targetChars: number;
  /** Words for the words shape. */
  readonly words?: readonly string[];
  /** Pre-extracted chunks for the text shape. */
  readonly textChunks?: readonly string[];
  readonly source: AdaptiveSource;
  readonly seed: number;
}

/**
 * The adaptive session builder: draw a unit by weakness, then materialize it. Returns
 * chunks and the separator to join them with, so the caller can render without knowing
 * which shape ran.
 */
export function buildAdaptiveDrill(spec: DrillSpec): Drill {
  const rng = createRng(spec.seed);
  const words = spec.words ?? [];
  const sourceChunks = spec.textChunks ?? [];
  const source = spec.shape === 'words' ? words : spec.shape === 'text' ? sourceChunks : [];
  if (spec.shape !== 'patterns' && source.length === 0) {
    throw new EmptyDrillSourceError(`no chunks are available for the ${spec.shape} shape`);
  }

  // A newline is a chunk in its own right — it is what keeps the source's line
  // structure — but it is never what a drawn unit materializes into, so it is not
  // indexed. The newlines still reach the target because the chunks are joined whole.
  const index = buildUnitIndex(source.filter((chunk) => chunk !== '\n' && chunk !== ''));
  // Only units the materializer can actually produce are worth drawing: the units of
  // the source for words and text, the enabled characters for patterns.
  const available =
    spec.shape === 'patterns' ? undefined : new Set(index.keys());
  const candidates = buildCandidates(spec.source, available);
  if (candidates.length === 0) {
    throw new EmptyDrillSourceError('no units are available to drill');
  }

  const context: MaterializeContext = {
    shape: spec.shape,
    charsets: spec.charsets,
    words,
    sourceChunks,
    index,
    rng,
  };
  const groups: string[] = [];
  const uses = new Map<string, number>();
  const target = Math.max(1, Math.floor(spec.targetChars));
  const maxGroups = target + 100;
  let chars = 0;
  let lineBreaks = 0;
  let previousUnit: string | undefined;
  let previousText: string | undefined;

  while (chars < target && groups.length < maxGroups) {
    const candidate = sampleCandidate(candidates, rng, {
      ...(previousUnit === undefined ? {} : { avoid: previousUnit }),
      uses,
    });
    const text = materializeUnit(candidate.unit, context, previousText);
    if (text.length === 0) {
      break;
    }
    groups.push(text);
    chars += text.length;
    if (text === '\n') {
      lineBreaks += 1;
    }
    uses.set(candidate.unit, (uses.get(candidate.unit) ?? 0) + 1);
    previousUnit = candidate.unit;
    previousText = text;
  }

  // The text shape reproduces the source exactly, so nothing is inserted between
  // chunks: a newline chunk is already the line break, and a run follows the previous
  // one directly. The words and patterns shapes need the space, because it is the
  // separator the user types.
  const separator = spec.shape === 'text' ? '' : ' ';
  return { groups, text: groups.join(separator), separator, lineBreaks };
}
