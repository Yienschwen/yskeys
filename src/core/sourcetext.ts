import {
  MAX_SOURCE_CHUNKS,
  MAX_SOURCE_RUN_CHARS,
  MAX_SOURCE_TEXT_CHARS,
  MIN_SOURCE_FILE_CHARS,
  MIN_SOURCE_RUN_CHARS,
  SOURCE_EXCLUDED_FILES,
  SOURCE_EXCLUDED_SEGMENTS,
  SOURCE_EXTENSIONS,
  SOURCE_FILENAMES,
} from '../config';

/**
 * Turning a repository — a `.zip`, a folder of files, or a pasted block — into practice
 * text. Pure and dependency-free on purpose: the archive reader lives in
 * `core/archive.ts` and hands the entries here, so the interesting rules (what is
 * source, what is generated, what is not typeable) are testable without a browser.
 *
 * The shape of the result is *chunks*: the units the drill displays. A chunk is a run
 * of typeable characters, taken from one line, capped at `MAX_SOURCE_RUN_CHARS` so a
 * minified bundle cannot swallow a whole drill. Newlines are preserved as real targets
 * so code keeps its shape.
 */

export interface SourceStats {
  /** Bytes (or characters, for pasted text) offered to the extractor. */
  readonly bytes: number;
  /** Files that were read and kept. */
  readonly files: number;
  /** Files rejected: wrong extension, excluded path, or not enough typeable text. */
  readonly skipped: number;
  /** Lines the extractor threw away (blank, or nothing typeable). */
  readonly lines: number;
}

export interface TextSource {
  /** What the user uploaded: a file name, an archive name, or "Pasted text". */
  readonly name: string;
  readonly importedAt: number;
  /** Normalised practice text. Survives reloads; never leaves the browser. */
  readonly text: string;
  readonly stats: SourceStats;
}

export type SourceFile = { readonly path: string; readonly text: string };

/* ------------------------------------------------------------- normalisation -- */

/** Every character a US QWERTY layout can type, plus the two control characters. */
const TYPEABLE = new Set<string>([...' \t\n']);

export function isTypeable(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x21 && code <= 0x7e) || TYPEABLE.has(char);
}

/**
 * Normalises whitespace and drops anything the keyboard cannot produce. Runs are not
 * merged across lines: the newline is kept, because the text shape exercises Enter.
 */
export function normalizeSourceText(raw: string): string {
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let out = '';
  for (const char of withoutBom.replace(/\r\n?/g, '\n')) {
    if (char === '\n') {
      out += '\n';
    } else if (char === '\t') {
      out += '\t';
    } else if (isTypeable(char)) {
      out += char;
    } else if (char === ' ') {
      out += ' ';
    } else {
      // Everything else — other Unicode, control bytes, NBSP — becomes a separator.
      out += ' ';
    }
  }
  return out
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* --------------------------------------------------------------------- chunking -- */

export interface ChunkOptions {
  /** Characters an enabled charset can produce, plus space and tab. */
  readonly allowedChars: ReadonlySet<string>;
  /** `false` drops every newline and keeps the drill on one line. */
  readonly keepLineBreaks: boolean;
  readonly maxChunks?: number;
  readonly maxRunChars?: number;
  readonly minRunChars?: number;
}

export interface ChunkResult {
  readonly chunks: readonly string[];
  /** Characters that were dropped because no enabled charset can type them. */
  readonly dropped: number;
}

/**
 * Splits normalised text into drill chunks.
 *
 * A chunk is one or more whitespace-separated tokens from the same line: at least
 * `minRunChars` content characters, at most `maxRunChars`, and never padded with
 * whitespace at either end. The drill joins chunks with a single space — the separator
 * the user types — so a chunk boundary is always a visible space.
 *
 * A token too short to stand on its own (`a` or `=` in code) is carried into the next
 * chunk rather than dropped. Characters the enabled charsets cannot type *are* dropped,
 * and counted: a user who enabled only `a–z` deserves to know how much of their code
 * that removed.
 */
export function extractChunks(text: string, options: ChunkOptions): ChunkResult {
  const maxChunks = options.maxChunks ?? MAX_SOURCE_CHUNKS;
  const maxRunChars = options.maxRunChars ?? MAX_SOURCE_RUN_CHARS;
  const minRunChars = options.minRunChars ?? MIN_SOURCE_RUN_CHARS;
  const allowed = options.allowedChars;

  const chunks: string[] = [];
  let run = '';
  let runDropped = 0;

  const flush = (): void => {
    for (const chunk of chunksForRun(run, minRunChars, maxRunChars)) {
      if (chunks.length >= maxChunks) {
        break;
      }
      // Every chunk is exactly one space from the previous one in the drill, so that
      // space is part of what was kept.
      if (chunks.length > 0) {
        runDropped -= 1;
      }
      chunks.push(chunk);
    }
    run = '';
  };

  for (const char of text) {
    if (char === '\n') {
      // A newline always ends a chunk: it is the display separator in this shape.
      flush();
      if (options.keepLineBreaks && chunks.length < maxChunks) {
        chunks.push('\n');
      }
      continue;
    }
    if (!allowed.has(char)) {
      flush();
      runDropped += 1;
      continue;
    }
    run += char;
  }
  flush();

  return { chunks, dropped: Math.max(0, runDropped) };
}

/** Turns one line into chunks of whole tokens, each at least `minRunChars` long. */
function chunksForRun(run: string, minRunChars: number, maxRunChars: number): string[] {
  const tokens = run.split(/[ \t]+/).filter((token) => token.length > 0);
  const chunks: string[] = [];
  let group: string[] = [];
  let length = 0;

  const emit = (): void => {
    if (group.length === 0) {
      return;
    }
    let remaining = group.join(' ');
    group = [];
    length = 0;
    // Only one token can exceed the cap, and it is split rather than dropped.
    while (remaining.length > 0) {
      const slice = remaining.slice(0, maxRunChars);
      chunks.push(slice);
      remaining = remaining.slice(slice.length);
    }
  };

  for (const token of tokens) {
    if (length > 0 && length + 1 + token.length > maxRunChars) {
      emit();
    }
    group.push(token);
    length = length === 0 ? token.length : length + 1 + token.length;
    if (length >= minRunChars) {
      emit();
    }
  }
  emit();

  return chunks;
}

/* ---------------------------------------------------------------- file filter -- */

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

export function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).toLowerCase();
}

/** Whether a path is a candidate for practice text, by name alone. */
export function isSourcePath(path: string): boolean {
  const base = baseNameOf(path);
  if (SOURCE_EXCLUDED_FILES.includes(base)) {
    return false;
  }
  const segments = path.toLowerCase().split('/').slice(0, -1);
  if (segments.some((segment) => SOURCE_EXCLUDED_SEGMENTS.includes(segment))) {
    return false;
  }
  return SOURCE_EXTENSIONS.includes(extensionOf(path)) || SOURCE_FILENAMES.includes(base);
}

export interface ExtractOptions {
  readonly allowedChars: ReadonlySet<string>;
  readonly keepLineBreaks: boolean;
  readonly maxChars?: number;
  readonly maxChunks?: number;
  /**
   * Whether to apply the source-file name filter. `true` (the default) is right for an
   * archive, where the filter is the only thing standing between the user and a
   * `node_modules` dump. Files the user picked by hand are read whatever they are
   * called, so that path passes `false`.
   */
  readonly filterPaths?: boolean;
}

export interface ExtractResult {
  readonly text: string;
  readonly chunks: readonly string[];
  readonly stats: SourceStats;
  /** Paths that were read, so the UI can say what it actually used. */
  readonly usedPaths: readonly string[];
}

/**
 * Reads a set of files into one practice text. Files are visited in the order given, so
 * the result is reproducible; the byte budget is spent first-come, which is why the
 * archive reader sorts entries before calling this.
 */
export function extractSourceText(
  files: readonly SourceFile[],
  options: ExtractOptions,
): ExtractResult {
  const maxChars = options.maxChars ?? MAX_SOURCE_TEXT_CHARS;
  const maxChunks = options.maxChunks ?? MAX_SOURCE_CHUNKS;
  const filterPaths = options.filterPaths ?? true;
  const parts: string[] = [];
  const chunks: string[] = [];
  const usedPaths: string[] = [];
  let bytes = 0;
  let skipped = 0;
  let lines = 0;
  let chars = 0;

  for (const file of files) {
    bytes += file.text.length;
    if (chars >= maxChars || chunks.length >= maxChunks) {
      skipped += 1;
      continue;
    }
    if (filterPaths && !isSourcePath(file.path)) {
      skipped += 1;
      continue;
    }
    const normalized = normalizeSourceText(file.text);
    if (normalized.length < MIN_SOURCE_FILE_CHARS) {
      skipped += 1;
      continue;
    }
    const extracted = extractChunks(normalized, {
      allowedChars: options.allowedChars,
      keepLineBreaks: options.keepLineBreaks,
      maxChunks: maxChunks - chunks.length,
    });
    if (extracted.chunks.length === 0) {
      skipped += 1;
      continue;
    }
    const budget = maxChars - chars;
    let text = normalized;
    if (text.length > budget) {
      text = text.slice(0, budget);
    }
    chars += text.length;
    lines += text.split('\n').length;
    parts.push(text);
    chunks.push(...extracted.chunks);
    usedPaths.push(file.path);
  }

  return {
    text: parts.join('\n'),
    chunks,
    stats: { bytes, files: usedPaths.length, skipped, lines },
    usedPaths,
  };
}

/**
 * A single pasted block, which has no file name and no extension filter: if the user
 * pasted it, they meant it.
 */
export function extractPastedText(text: string, options: ExtractOptions): ExtractResult {
  const normalized = normalizeSourceText(text).slice(
    0,
    options.maxChars ?? MAX_SOURCE_TEXT_CHARS,
  );
  if (normalized.length === 0) {
    return {
      text: '',
      chunks: [],
      stats: { bytes: text.length, files: 0, skipped: 0, lines: 0 },
      usedPaths: [],
    };
  }
  const extracted = extractChunks(normalized, {
    allowedChars: options.allowedChars,
    keepLineBreaks: options.keepLineBreaks,
    ...(options.maxChunks === undefined ? {} : { maxChunks: options.maxChunks }),
  });
  return {
    text: normalized,
    chunks: extracted.chunks,
    stats: {
      bytes: text.length,
      files: normalized.length >= MIN_SOURCE_FILE_CHARS ? 1 : 0,
      skipped: 0,
      lines: normalized.split('\n').length,
    },
    usedPaths: [],
  };
}
