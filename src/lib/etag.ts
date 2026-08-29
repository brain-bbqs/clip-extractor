import { createSHA256 } from "hash-wasm";
import SparkMD5 from "spark-md5";
import type { FilePart } from "./types";

// DANDI addresses blobs by a "dandi-etag" — the S3 multipart ETag (an MD5 of the concatenated
// per-part MD5s, suffixed with the part count) — so the part layout used to hash a file must match
// the one the server plans for its upload. Ported from brain-bbqs/bbqs-uploader, minus its worker
// pool: an upload here is at most two files, and the 16MB chunk loop below yields to the event loop
// between chunks, so the page stays responsive without the extra machinery.

const MB = 2 ** 20;
const GB = 2 ** 30;
const TB = 2 ** 40;
const MAX_PARTS = 10_000;
const MIN_PART_SIZE = 5 * MB;
const MAX_PART_SIZE = 5 * GB;
const DEFAULT_PART_SIZE = 64 * MB;
const HASH_CHUNK = 16 * MB;

/** Faithful port of dandischema.digests.dandietag.PartGenerator. */
export function planParts(fileSize: number): FilePart[] {
  if (fileSize <= 0) throw new Error("Empty files cannot be uploaded to EMBER.");
  if (fileSize > 5 * TB) throw new Error("File is larger than the S3 maximum object size (5 TB).");

  let partSize = DEFAULT_PART_SIZE;
  if (Math.ceil(fileSize / partSize) >= MAX_PARTS) {
    partSize = Math.ceil(fileSize / MAX_PARTS);
  }
  if (partSize < MIN_PART_SIZE || partSize > MAX_PART_SIZE) {
    throw new Error("Internal error: computed part size is outside S3 limits.");
  }

  let partQty = Math.floor(fileSize / partSize);
  let finalPartSize = fileSize - partQty * partSize;
  if (finalPartSize === 0) {
    finalPartSize = partSize;
  } else {
    partQty += 1;
  }
  if (partQty === 1) partSize = finalPartSize;

  const parts: FilePart[] = [];
  let offset = 0;
  for (let number = 1; number <= partQty; number++) {
    const size = number === partQty ? finalPartSize : partSize;
    parts.push({ number, offset, size });
    offset += size;
  }
  return parts;
}

/** Reads `length` bytes of `blob` from `offset` in HASH_CHUNK-sized pieces, handing each to `take`
 * along with the running total read so far, so a multi-gigabyte source never lands in memory whole.
 * Every hash below is one pass of this: what differs between them is only which digest the bytes go
 * into and how the running total is reported.
 *
 * A short read means the file changed underneath the hash — a browser hands out a `File` as a live
 * handle on something the visitor can still edit or unmount — and a digest folded from part-old,
 * part-new bytes would name a blob that never existed. */
async function eachChunk(blob: Blob, offset: number, length: number, take: (buf: ArrayBuffer, readSoFar: number) => void): Promise<void> {
  let read = 0;
  while (read < length) {
    const n = Math.min(HASH_CHUNK, length - read);
    const start = offset + read;
    const buf = await blob.slice(start, start + n).arrayBuffer();
    if (buf.byteLength !== n) {
      throw new Error("The source file changed while hashing — please re-load it.");
    }
    read += n;
    take(buf, read);
  }
}

/** MD5 of one part of a blob, streamed in 16MB chunks so a large source video never lands in
 * memory whole. */
export async function hashPart(blob: Blob, part: FilePart, onChunk: (bytesDoneInPart: number) => void): Promise<Uint8Array> {
  const spark = new SparkMD5.ArrayBuffer();
  await eachChunk(blob, part.offset, part.size, (buf, read) => {
    spark.append(buf);
    onChunk(read);
  });
  // end(true) yields the raw 16-byte digest as a binary string
  const raw = spark.end(true);
  const digest = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    digest[i] = raw.charCodeAt(i) & 0xff;
  }
  return digest;
}

/** Folds the concatenated per-part digests (16 bytes per part, in part order) into the final etag. */
export function combineDigests(partDigests: Uint8Array, partCount: number): string {
  const finalSpark = new SparkMD5.ArrayBuffer();
  finalSpark.append(partDigests.buffer as ArrayBuffer);
  return `${finalSpark.end()}-${partCount}`;
}

/** Hashes every part of `blob` in order and returns its dandi-etag, reporting 0..1 progress. */
export async function computeDandiEtag(blob: Blob, parts: FilePart[], onProgress: (fraction: number) => void = () => {}): Promise<string> {
  const total = parts.reduce((sum, p) => sum + p.size, 0);
  const digests = new Uint8Array(parts.length * 16);
  let done = 0;
  for (const part of parts) {
    digests.set(await hashPart(blob, part, (n) => onProgress(total ? (done + n) / total : 1)), (part.number - 1) * 16);
    done += part.size;
  }
  onProgress(1);
  return combineDigests(digests, parts.length);
}

/** Plain whole-file MD5 — independent of the dandi-etag above, which even for a single-part blob is
 * `md5(md5(file))` rather than `md5(file)` (see `ProvenanceChecksum`'s own comment on that). A
 * sidecar's own `Checksum` field (lib/provenance.ts) names both, since only the dandi-etag identifies
 * the blob to the archive but a plain MD5 is what most tooling outside it expects. Streamed in the
 * same HASH_CHUNK-sized reads as `hashPart`, so a large source video never lands in memory whole; a
 * separate pass over the bytes rather than folded into `computeDandiEtag`'s, since that one resets its
 * digest at every part boundary and this one must not. */
export async function computeMd5(blob: Blob, onProgress: (fraction: number) => void = () => {}): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer();
  await eachChunk(blob, 0, blob.size, (buf, read) => {
    spark.append(buf);
    onProgress(blob.size ? read / blob.size : 1);
  });
  onProgress(1);
  return spark.end();
}

/** Plain whole-file SHA-256, streamed in the same HASH_CHUNK-sized reads as `computeMd5` above so a
 * large source video never lands in memory whole. Web Crypto's own `crypto.subtle.digest` cannot do
 * this — it has no incremental API, so it would need the entire file buffered at once — hence
 * hash-wasm, whose hashers take the bytes a chunk at a time the way SparkMD5 does. A separate pass
 * over the bytes, for the same reason `computeMd5` is one. */
export async function computeSha256(blob: Blob, onProgress: (fraction: number) => void = () => {}): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  await eachChunk(blob, 0, blob.size, (buf, read) => {
    hasher.update(new Uint8Array(buf));
    onProgress(blob.size ? read / blob.size : 1);
  });
  onProgress(1);
  return hasher.digest("hex");
}
