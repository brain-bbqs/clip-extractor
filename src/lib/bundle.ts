// Packs the files an upload would have written into a single gzip-compressed tar, so the Save route
// hands over exactly what the Upload route would have sent — unpacking a bundle reproduces the very
// directory tree the archive would have held, provenance sidecar and all.
//
// tar is written here rather than pulled in as a dependency: the format is a 512-byte header per
// file and nothing else, and gzip is already in the browser as CompressionStream.

/** One file of a bundle: the bytes, and the path it sits at inside the archive. */
export interface BundleEntry {
  path: string;
  blob: Blob;
}

const BLOCK = 512;
const NAME_LENGTH = 100;
const PREFIX_LENGTH = 155;
/** The same 16MB read window lib/etag.ts hashes with, so a multi-gigabyte original is never held in
 * memory whole on its way into the bundle. */
const READ_CHUNK = 16 * 2 ** 20;

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Splits a path across ustar's two name fields: up to 155 bytes of leading directories in `prefix`
 * and up to 100 bytes in `name`, which a reader rejoins with a `/`. Short paths use `name` alone,
 * which is what every tar reader handles; the split only matters for the deeper ones.
 */
export function splitUstarPath(path: string): { name: string; prefix: string } {
  if (byteLength(path) <= NAME_LENGTH) return { name: path, prefix: "" };
  // Walk the separators left to right, so the first split that fits keeps `prefix` as short as
  // possible and leaves the recognizable end of the path in `name`.
  for (let cut = path.indexOf("/"); cut !== -1; cut = path.indexOf("/", cut + 1)) {
    const prefix = path.slice(0, cut);
    const name = path.slice(cut + 1);
    if (byteLength(prefix) <= PREFIX_LENGTH && byteLength(name) <= NAME_LENGTH) return { name, prefix };
  }
  throw new Error(`"${path}" is too long to store in a tar archive`);
}

function writeText(block: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  if (bytes.length > length) throw new Error(`"${value}" does not fit in a ${length}-byte tar header field`);
  block.set(bytes, offset);
}

/** Numeric tar fields are octal digits, zero-padded, closed by a NUL. */
function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  writeText(block, offset, length, value.toString(8).padStart(length - 1, "0"));
}

/** The 512-byte ustar header that precedes a file's bytes. */
function tarHeader(path: string, size: number, modified: Date): Uint8Array<ArrayBuffer> {
  const { name, prefix } = splitUstarPath(path);
  const block = new Uint8Array(BLOCK);
  writeText(block, 0, NAME_LENGTH, name);
  writeOctal(block, 100, 8, 0o644); // mode: a plain readable file
  writeOctal(block, 108, 8, 0); // uid
  writeOctal(block, 116, 8, 0); // gid
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, Math.floor(modified.getTime() / 1000));
  // The checksum is summed over a header whose own checksum field reads as eight spaces.
  block.fill(0x20, 148, 156);
  block[156] = 0x30; // typeflag "0": a regular file
  writeText(block, 257, 6, "ustar"); // magic, NUL-terminated by the zeroed block
  writeText(block, 263, 2, "00"); // version
  writeText(block, 345, PREFIX_LENGTH, prefix);
  // Six octal digits, a NUL, then a space — the one field that is not plain writeOctal.
  const sum = block.reduce((total, byte) => total + byte, 0);
  writeText(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}

async function writeBlob(writer: WritableStreamDefaultWriter<BufferSource>, blob: Blob): Promise<void> {
  for (let offset = 0; offset < blob.size; offset += READ_CHUNK) {
    // A view rather than the raw ArrayBuffer: node's CompressionStream only accepts typed arrays.
    await writer.write(new Uint8Array(await blob.slice(offset, offset + READ_CHUNK).arrayBuffer()));
  }
}

/**
 * Tars `entries` in the order given and gzips the result, stamping every file with `modified` (the
 * moment the selection was extracted) so a bundle is reproducible rather than clock-dependent.
 */
export async function tarGzip(entries: BundleEntry[], modified: Date): Promise<Blob> {
  if (typeof CompressionStream === "undefined") {
    throw new Error(
      "This browser cannot compress a saved bundle (CompressionStream is unavailable) — try a current Chrome, Firefox or Safari.",
    );
  }
  const gzip = new CompressionStream("gzip");
  // Consume the compressed side before writing a single byte into it: a CompressionStream applies
  // backpressure, so writing with nothing reading would deadlock on the first full chunk.
  const compressed = new Response(gzip.readable).blob();
  const writer = gzip.writable.getWriter();
  try {
    for (const entry of entries) {
      await writer.write(tarHeader(entry.path, entry.blob.size, modified));
      await writeBlob(writer, entry.blob);
      // Every file is padded out to a whole number of 512-byte blocks.
      const padding = (BLOCK - (entry.blob.size % BLOCK)) % BLOCK;
      if (padding) await writer.write(new Uint8Array(padding));
    }
    // Two zero blocks close a tar archive.
    await writer.write(new Uint8Array(2 * BLOCK));
    await writer.close();
  } catch (e) {
    await writer.abort(e).catch(() => {});
    // Aborting errors the compressed side too, and nothing is going to await it now — left
    // unobserved, that surfaces as an unhandled rejection rather than the failure below.
    await compressed.catch(() => {});
    throw e;
  }
  const blob = await compressed;
  // slice() re-labels the content type without copying the bytes a second time.
  return blob.slice(0, blob.size, "application/gzip");
}
