import { createSHA256 } from "hash-wasm";
import { createEtag } from "@brain-bbqs/ember-client";

// The dandi-etag, the per-part MD5 and the plain MD5 are @brain-bbqs/ember-client's, bound here to
// this app's wording for a source that changes mid-hash (its empty and oversized file messages
// already match the package's). An upload here is at most two files, and the shared chunk loop
// yields to the event loop between chunks, so the page stays responsive without bbqs-uploader's
// worker pool.
const etag = createEtag({
  fileChanged: "The source file changed while hashing — please re-load it.",
});

export const { hashPart, computeDandiEtag, computeMd5 } = etag;

/** Plain whole-file SHA-256, streamed through the same 16MB chunked reader as `computeMd5` so a
 * large source video never lands in memory whole, with the same interruption checks and short-read
 * error. Web Crypto's own `crypto.subtle.digest` cannot do this (it has no incremental API, so it
 * would need the entire file buffered at once), hence hash-wasm, whose hashers take the bytes a
 * chunk at a time the way SparkMD5 does. A separate pass over the bytes, since the dandi-etag resets
 * its digest at every part boundary and this one must not. */
export async function computeSha256(blob: Blob, onProgress: (fraction: number) => void = () => {}, signal?: AbortSignal): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  await etag.readChunks(
    blob,
    0,
    blob.size,
    (buf, read) => {
      hasher.update(new Uint8Array(buf));
      onProgress(read / blob.size);
    },
    signal,
  );
  onProgress(1);
  return hasher.digest("hex");
}
