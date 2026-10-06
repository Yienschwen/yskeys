import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_CHUNKS,
  MAX_SOURCE_RUN_CHARS,
  MAX_SOURCE_TEXT_CHARS,
  MIN_SOURCE_FILE_CHARS,
} from '../config';
import {
  extractChunks,
  extractPastedText,
  extractSourceText,
  extensionOf,
  isSourcePath,
  isTypeable,
  normalizeSourceText,
} from '../core/sourcetext';

/** Lowercase letters plus space and tab, the common case for "only a–z is enabled". */
const LETTERS = new Set([...'abcdefghijklmnopqrstuvwxyz', ' ', '\t']);

function chunksOf(text: string): string[] {
  return [...extractChunks(text, { allowedChars: LETTERS, keepLineBreaks: true }).chunks];
}

describe('normalizeSourceText', () => {
  it('drops a BOM and normalises every line ending to one newline', () => {
    expect(normalizeSourceText('\uFEFFa\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('replaces characters no keyboard can produce with a single space', () => {
    expect(normalizeSourceText('a\u00a0b\u2014c\u4e2dd')).toBe('a b c d');
  });

  it('collapses runs of spaces and tabs, but never a newline', () => {
    expect(normalizeSourceText('a   b\t\tc')).toBe('a b c');
    expect(normalizeSourceText('a   \n\t  b')).toBe('a\nb');
    expect(normalizeSourceText('a\n\n\nb')).toBe('a\n\n\nb');
  });

  it('trims the ends, so a chunk never starts with useless whitespace', () => {
    expect(normalizeSourceText('\n\n  hello  \n\n')).toBe('hello');
  });

  it('classifies characters the way the layout does', () => {
    expect(isTypeable('a')).toBe(true);
    expect(isTypeable('~')).toBe(true);
    expect(isTypeable(' ')).toBe(true);
    expect(isTypeable('\n')).toBe(true);
    expect(isTypeable('\t')).toBe(true);
    expect(isTypeable('中')).toBe(false);
    expect(isTypeable('\u00a0')).toBe(false);
  });
});

describe('extractChunks', () => {
  it('groups whole tokens into chunks, never splitting a word', () => {
    expect(chunksOf('const a b c d\nconst e f g h')).toEqual([
      'const',
      'a b',
      'c d',
      '\n',
      'const',
      'e f',
      'g h',
    ]);
  });

  it('never emits a chunk with leading or trailing whitespace', () => {
    for (const chunk of chunksOf('   const     efg   hi   ')) {
      expect(chunk).toBe(chunk.trim());
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('emits one chunk per token when only short tokens are typeable', () => {
    // Even keeping 'const' and 'return', a single-letter argument is its own token.
    expect(chunksOf('return a;')).toEqual(['return', 'a']);
  });

  it('cuts a typeable code line into chunks of whole tokens', () => {
    const full = new Set([
      ...'abcdefghijklmnopqrstuvwxyz0123456789',
      ' ', '=', ';', '(', ')', '{', '}', '+', '.',
    ]);
    const chunks = extractChunks('const a = 1;\nreturn a + 1;', {
      allowedChars: full,
      keepLineBreaks: true,
    }).chunks;

    // Boundaries fall between tokens, so nothing is ever cut mid-word, and the newline
    // stays a target of its own.
    expect([...chunks]).toEqual(['const', 'a =', '1;', '\n', 'return', 'a +', '1;']);
  });

  it('keeps a newline chunk between lines when asked', () => {
    const chunks = chunksOf('one\ntwo');
    expect(chunks).toEqual(['one', '\n', 'two']);
  });

  it('drops newlines when the caller wants one long line', () => {
    const chunks = extractChunks('one\ntwo', {
      allowedChars: LETTERS,
      keepLineBreaks: false,
    }).chunks;
    expect(chunks).toEqual(['one', 'two']);
  });

  it('splits a single token that is longer than the cap, not the line around it', () => {
    const long = 'a'.repeat(MAX_SOURCE_RUN_CHARS * 2 + 5);
    const chunks = chunksOf(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_SOURCE_RUN_CHARS);
    }
    // Only the separators the writer dropped are missing.
    expect(chunks.join('')).toBe(long);
  });

  it('drops a run the enabled charsets cannot type, and counts what it dropped', () => {
    const result = extractChunks('abc 123 def', {
      allowedChars: LETTERS,
      keepLineBreaks: true,
    });
    // 'abc' stands alone; 'def' is carried on its own because '123' vanished.
    expect([...result.chunks]).toEqual(['abc', 'def']);
    expect(result.dropped).toBe(2);
  });

  it('keeps a one-letter token only when nothing longer is available', () => {
    // Greedy grouping: 'i a' already reaches the minimum, so it becomes a chunk of two
    // tokens rather than being thrown away. The pattern generator covers single keys.
    const result = extractChunks('i a hello', { allowedChars: LETTERS, keepLineBreaks: true });
    expect([...result.chunks]).toEqual(['i a', 'hello']);
    expect(result.dropped).toBe(0);
  });

  it('stops adding chunks at the cap', () => {
    const many = Array.from({ length: 20 }, () => 'hello').join('\n');
    const result = extractChunks(many, {
      allowedChars: LETTERS,
      keepLineBreaks: true,
      maxChunks: 3,
    });
    expect(result.chunks).toHaveLength(3);
  });

  it('returns nothing for text that is entirely untypeable', () => {
    expect(chunksOf('中文测试')).toEqual([]);
  });

  it('has a cap that is a real number, not a placeholder', () => {
    expect(MAX_SOURCE_CHUNKS).toBeGreaterThan(1000);
  });
});

describe('isSourcePath and extensionOf', () => {
  it('reads the extension from the last segment only', () => {
    expect(extensionOf('src/app.test.ts')).toBe('.ts');
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('a/b/c.TS')).toBe('.ts');
  });

  it('accepts source and text files', () => {
    for (const path of ['src/main.ts', 'lib/util.py', 'README.md', 'go.sum.go', 'Dockerfile']) {
      expect(isSourcePath(path), path).toBe(true);
    }
  });

  it('reads hand-picked files whatever they are called, when asked to', () => {
    const result = extractSourceText(
      [{ path: 'notes.zip', text: 'const answer to everything is forty two and more words\n' }],
      { allowedChars: LETTERS, keepLineBreaks: true, filterPaths: false },
    );
    expect(result.usedPaths).toEqual(['notes.zip']);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it('rejects generated files, vendored trees and binaries', () => {
    for (const path of [
      'package-lock.json',
      'pnpm-lock.yaml',
      'node_modules/pkg/index.js',
      'dist/bundle.js',
      '.git/config.ts',
      'assets/logo.png',
      'docs/photo.jpeg',
      'coverage/lcov.ts',
      'a/b/__pycache__/x.py',
    ]) {
      expect(isSourcePath(path), path).toBe(false);
    }
  });
});

describe('extractSourceText', () => {
  const options = { allowedChars: LETTERS, keepLineBreaks: true };

  it('keeps the readable files and reports what it threw away', () => {
    const result = extractSourceText(
      [
        { path: 'src/a.ts', text: 'const a b c d and more words\nconst e f g h' },
        { path: 'node_modules/x/y.js', text: 'ignored entirely' },
        { path: 'README.md', text: 'hello world and more words here to read aloud' },
        { path: 'tiny.ts', text: 'a' },
      ],
      options,
    );

    // Files are visited in the order given, which is what makes the result reproducible.
    expect(result.usedPaths).toEqual(['src/a.ts', 'README.md']);
    expect(result.stats.files).toBe(2);
    expect(result.stats.skipped).toBe(2);
    expect(result.text).toContain('const a b c d');
    expect(result.text).toContain('hello world');
    expect(result.chunks).toContain('\n');
  });

  it('spends the character budget in file order and skips the rest', () => {
    const big = 'x'.repeat(MIN_SOURCE_FILE_CHARS * 4);
    const result = extractSourceText(
      [
        { path: 'a.ts', text: big },
        { path: 'b.ts', text: big },
      ],
      { ...options, maxChars: MIN_SOURCE_FILE_CHARS * 4 },
    );

    expect(result.stats.files).toBe(1);
    expect(result.stats.skipped).toBe(1);
    expect(result.text.length).toBeLessThanOrEqual(MIN_SOURCE_FILE_CHARS * 4);
  });

  it('is empty, and says so, when nothing can be typed', () => {
    const result = extractSourceText([{ path: 'a.ts', text: '中文中文中文中文中文中文' }], options);
    expect(result.chunks).toEqual([]);
    expect(result.text).toBe('');
    expect(result.stats.files).toBe(0);
  });

  it('never keeps more than the character cap', () => {
    const result = extractSourceText(
      [{ path: 'a.ts', text: 'word '.repeat(MAX_SOURCE_TEXT_CHARS) }],
      options,
    );
    expect(result.text.length).toBeLessThanOrEqual(MAX_SOURCE_TEXT_CHARS);
    expect(result.stats.bytes).toBeGreaterThan(0);
  });
});

describe('extractPastedText', () => {
  const options = { allowedChars: LETTERS, keepLineBreaks: true };

  it('takes a pasted block as-is, with no file-name filter', () => {
    const result = extractPastedText('hello world and some more text\nsecond line here', options);
    expect(result.text).toBe('hello world and some more text\nsecond line here');
    expect([...result.chunks]).toContain('\n');
    expect(result.stats.files).toBe(1);
  });

  it('reports an empty result for text that cannot be typed', () => {
    const result = extractPastedText('中文', options);
    expect(result.chunks).toEqual([]);
    expect(result.text).toBe('');
    expect(result.stats.files).toBe(0);
  });

  it('trims to the cap before extracting', () => {
    const result = extractPastedText('x'.repeat(MAX_SOURCE_TEXT_CHARS + 500), options);
    expect(result.text.length).toBe(MAX_SOURCE_TEXT_CHARS);
  });
});
