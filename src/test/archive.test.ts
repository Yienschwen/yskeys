import { describe, expect, it } from 'vitest';
import { readZipDirectory, readZipEntries } from '../core/archive';

/**
 * A real DEFLATE zip, built once and embedded as base64. Testing the reader against a
 * hand-written byte array would only prove that the test agrees with the parser; a zip
 * produced by a different implementation proves the parser agrees with the format.
 *
 * Contents: `src/index.ts`, `src/util.py`, `README.md`, `notes`, `node_modules/pkg/index.js`,
 * `package-lock.json` and `assets/logo.png`.
 */
const ZIP_BASE64 =
  'UEsDBBQAAAAIAO2oRl1canCbOAAAAD4AAAAMAAAAc3JjL2luZGV4LnRzS60oyC8qUUgrzUsuyczP' +
  'U0hMSdFItFLIK81NSi3SUUiCMTUVqrkUFIpSS0qLgIoUtBWSrLlquQBQSwMEFAAAAAgA7ahGXYpo' +
  'nOIqAAAALAAAAAsAAABzcmMvdXRpbC5weUtJTVNIL0pNLdHIS8xN1bTiUgCCotSS0qI8hTT1jNSc' +
  'nHyFapBUrToXAFBLAwQUAAAACADtqEZdN2qPpjEAAAAvAAAACQAAAFJFQURNRS5tZFNWcEnNzefi' +
  'clQoycyrVChKLchXKC1OTVFILFYoKEpMLslMTlXITSxJLcpMzNHjAgBQSwMEFAAAAAgA7ahGXfjH' +
  '0iceAAAAHAAAABkAAABub2RlX21vZHVsZXMvcGtnL2luZGV4Lmpzy81PKc1J1UutKMgvKilWsFVQ' +
  'L87OLFDITVW35gIAUEsDBBQAAAAIAO2oRl2hf6XLGAAAABYAAAARAAAAcGFja2FnZS1sb2NrLmpz' +
  'b26rVsrJT85Oy8xJDUstKs7Mz1OyUjCuBQBQSwMEFAAAAAgA7ahGXbzz+AcSAAAAEAAAAA8AAABh' +
  'c3NldHMvbG9nby5wbmfrDPBz5+WS4mJgSMrMSyyqBABQSwMEFAAAAAgA7ahGXbbT6yk6AAAAQQAA' +
  'AAUAAABub3Rlcw3IwQ2AMAwDwD9TeLVQGRJRJah1BePDPS8LfMWcUYl9CYZB69C/OKITT8jBrHU6' +
  'mtuwJo4JFS7y3j5QSwECFAMUAAAACADtqEZdXGpwmzgAAAA+AAAADAAAAAAAAAAAAAAAgAEAAAAA' +
  'c3JjL2luZGV4LnRzUEsBAhQDFAAAAAgA7ahGXYponOIqAAAALAAAAAsAAAAAAAAAAAAAAIABYgAA' +
  'AHNyYy91dGlsLnB5UEsBAhQDFAAAAAgA7ahGXTdqj6YxAAAALwAAAAkAAAAAAAAAAAAAAIABtQAA' +
  'AFJFQURNRS5tZFBLAQIUAxQAAAAIAO2oRl34x9InHgAAABwAAAAZAAAAAAAAAAAAAACAAQ0BAABu' +
  'b2RlX21vZHVsZXMvcGtnL2luZGV4LmpzUEsBAhQDFAAAAAgA7ahGXaF/pcsYAAAAFgAAABEAAAAA' +
  'AAAAAAAAAIABYgEAAHBhY2thZ2UtbG9jay5qc29uUEsBAhQDFAAAAAgA7ahGXbzz+AcSAAAAEAAA' +
  'AA8AAAAAAAAAAAAAAIABqQEAAGFzc2V0cy9sb2dvLnBuZ1BLAQIUAxQAAAAIAO2oRl220+spOgAA' +
  'AEEAAAAFAAAAAAAAAAAAAACAAegBAABub3Rlc1BLBQYAAAAABwAHAKABAABFAgAAAAA='

/** One entry, written with `ZIP_STORED`, so the copy path is exercised too. */
const STORED_ZIP_BASE64 =
  'UEsDBBQAAAAAAPKoRl08SthLIQAAACEAAAAPAAAAcGxhaW4vaGVsbG8udHh0aGVsbG8gZnJvbSBh' +
  'biB1bmNvbXByZXNzZWQgZW50cnkKUEsBAhQDFAAAAAAA8qhGXTxK2EshAAAAIQAAAA8AAAAAAAAA' +
  'AAAAAIABAAAAAHBsYWluL2hlbGxvLnR4dFBLBQYAAAAAAQABAD0AAABOAAAAAAA='

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function zipBytes(): Uint8Array {
  return fromBase64(ZIP_BASE64);
}

describe('readZipDirectory', () => {
  it('lists every regular entry in the archive', () => {
    const result = readZipDirectory(zipBytes());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paths = result.entries.map((entry) => entry.path).sort();
    expect(paths).toEqual([
      'README.md',
      'assets/logo.png',
      'node_modules/pkg/index.js',
      'notes',
      'package-lock.json',
      'src/index.ts',
      'src/util.py',
    ]);
    expect(result.skipped).toBe(0);
  });

  it('filters by extension when asked', () => {
    const result = readZipDirectory(zipBytes(), { extensions: ['.ts', '.py'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((entry) => entry.path).sort()).toEqual([
        'src/index.ts',
        'src/util.py',
      ]);
      expect(result.skipped).toBe(5);
    }
  });

  it('refuses an archive with too many entries', () => {
    const result = readZipDirectory(zipBytes(), { maxEntries: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/too many/);
    }
  });

  it('refuses something that is not a zip at all, with a reason', () => {
    const result = readZipDirectory(new TextEncoder().encode('just some text, definitely not a zip'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/central directory/);
    }
  });

  it('refuses an archive that is too small to be one', () => {
    expect(readZipDirectory(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });

  it('stops at the size cap rather than reading a huge file', () => {
    const big = new Uint8Array(30_000_000);
    const result = readZipDirectory(big);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/larger than/);
    }
  });
});

describe('readZipEntries', () => {
  it('inflates the requested entries and leaves the rest alone', async () => {
    const directory = readZipDirectory(zipBytes());
    expect(directory.ok).toBe(true);
    if (!directory.ok) {
      return;
    }
    const wanted = directory.entries
      .map((entry) => entry.path)
      .filter((path) => path.endsWith('.ts') || path.endsWith('.py'));

    const files = await readZipEntries(zipBytes(), wanted);
    expect(files.map((file) => file.path).sort()).toEqual(['src/index.ts', 'src/util.py']);

    const typescript = files.find((file) => file.path === 'src/index.ts');
    expect(typescript?.text).toContain('export function add');
    expect(typescript?.text).toContain('return a + b;');
    const python = files.find((file) => file.path === 'src/util.py');
    expect(python?.text).toContain("def greet(name):");
  });

  it('reads a stored (uncompressed) entry, with no inflater involved', async () => {
    const files = await readZipEntries(fromBase64(STORED_ZIP_BASE64), ['plain/hello.txt']);
    expect(files).toHaveLength(1);
    expect(files[0]?.text).toContain('hello from an uncompressed entry');
  });

  it('yields nothing for a path that is not in the archive', async () => {
    await expect(readZipEntries(zipBytes(), ['nope/missing.ts'])).resolves.toEqual([]);
  });
});
