import { MAX_ZIP_BYTES } from '../config';
import type { SourceFile } from './sourcetext';

/**
 * Minimal ZIP reader: `unzip(bytes) → { path, text }[]`.
 *
 * It exists because "upload a code repository" is one of the two ways a user can bring
 * their own practice material, and adding a zip library would break the project's only
 * hard architectural rule — no runtime dependencies. The format is read from the
 * central directory, which is the authoritative part. Decompression is delegated to the
 * platform's `DecompressionStream('deflate-raw')`, so nothing here implements DEFLATE.
 *
 * Limits are deliberate: the archive size, the entry count and each entry's
 * uncompressed size are all capped, and a truncated archive produces a reason rather
 * than an exception.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
/** The EOCD comment is at most 65,535 bytes, so the signature cannot be further back. */
const EOCD_SEARCH_WINDOW = 65_535 + EOCD_MIN_SIZE;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

export interface ZipEntry {
  readonly path: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

export type ZipReadResult =
  | { ok: true; entries: ZipEntry[]; skipped: number }
  | { ok: false; reason: string };

export interface UnzipOptions {
  /** Extensions to keep, lower-case and dot-prefixed. Empty means "keep everything". */
  readonly extensions?: readonly string[];
  readonly maxEntries?: number;
  /** Applied to the *uncompressed* size, so a zip bomb cannot be read into memory. */
  readonly maxEntryBytes?: number;
}

/** Reads the central directory. Everything else is built on this. */
export function readZipDirectory(bytes: Uint8Array, options: UnzipOptions = {}): ZipReadResult {
  if (bytes.length < EOCD_MIN_SIZE) {
    return { ok: false, reason: 'the archive is too small to be a zip file' };
  }
  if (bytes.length > MAX_ZIP_BYTES) {
    return { ok: false, reason: `the archive is larger than ${String(MAX_ZIP_BYTES)} bytes` };
  }
  const eocd = findEocd(bytes);
  if (eocd === null) {
    return { ok: false, reason: 'the central directory was not found (not a zip file?)' };
  }
  const view = viewOf(bytes);
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  const maxEntries = options.maxEntries ?? 20_000;
  if (count > maxEntries) {
    return { ok: false, reason: `the archive holds ${String(count)} entries, which is too many` };
  }
  if (directoryOffset >= bytes.length) {
    return { ok: false, reason: 'the central directory points past the end of the file' };
  }

  const entries: ZipEntry[] = [];
  let skipped = 0;
  let cursor = directoryOffset;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      return { ok: false, reason: `entry ${String(index)} has a malformed header` };
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length) {
      return { ok: false, reason: `entry ${String(index)} has a truncated name` };
    }
    const path = decodeText(bytes.subarray(nameStart, nameEnd));
    cursor = nameEnd + extraLength + commentLength;

    const acceptable =
      (method === METHOD_STORED || method === METHOD_DEFLATED) &&
      !path.endsWith('/') &&
      matchesExtension(path, options.extensions) &&
      uncompressedSize <= (options.maxEntryBytes ?? Infinity);
    if (!acceptable) {
      skipped += 1;
      continue;
    }
    entries.push({ path, method, compressedSize, uncompressedSize, localOffset });
  }

  return { ok: true, entries, skipped };
}

/** Decompresses the entries a caller actually wants, in the order given. */
export async function readZipEntries(
  bytes: Uint8Array,
  paths: readonly string[],
  options: UnzipOptions = {},
): Promise<SourceFile[]> {
  const directory = readZipDirectory(bytes, options);
  if (!directory.ok) {
    return [];
  }
  const byPath = new Map(directory.entries.map((entry) => [entry.path, entry]));
  const files: SourceFile[] = [];
  for (const path of paths) {
    const entry = byPath.get(path);
    if (entry === undefined) {
      continue;
    }
    const text = await readEntry(bytes, entry);
    if (text !== null) {
      files.push({ path, text });
    }
  }
  return files;
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string | null> {
  const view = viewOf(bytes);
  if (entry.localOffset + 30 > bytes.length) {
    return null;
  }
  // The local header repeats the name and extra fields with its own lengths, which are
  // not always the same as the central directory's.
  const localNameLength = view.getUint16(entry.localOffset + 26, true);
  const localExtraLength = view.getUint16(entry.localOffset + 28, true);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  if (dataStart >= bytes.length) {
    return null;
  }
  const dataEnd = dataStart + entry.compressedSize;
  const slice = bytes.subarray(dataStart, Math.min(dataEnd, bytes.length));

  if (entry.method === METHOD_STORED) {
    return decodeText(slice);
  }
  if (typeof DecompressionStream !== 'function') {
    return null;
  }
  try {
    // `slice` shares the input buffer, which may be a SharedArrayBuffer in theory;
    // copying it into a plain ArrayBuffer keeps `BlobPart` honest.
    const owned = Uint8Array.from(slice);
    const stream = new Blob([owned.buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
    return decodeText(inflated);
  } catch {
    return null;
  }
}

function findEocd(bytes: Uint8Array): number | null {
  const start = Math.max(0, bytes.length - EOCD_SEARCH_WINDOW);
  const view = viewOf(bytes);
  for (let offset = bytes.length - EOCD_MIN_SIZE; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return null;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function matchesExtension(path: string, extensions?: readonly string[]): boolean {
  if (extensions === undefined || extensions.length === 0) {
    return true;
  }
  const lower = path.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
