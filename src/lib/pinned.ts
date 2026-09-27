import { sha256 } from "hash-wasm";

/** Thrown when a file fetched from a third party is not byte-for-byte the one this app was built
 * against. The bytes are dropped rather than run. */
export class IntegrityError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    const name = new URL(url).pathname.split("/").pop() || url;
    super(
      `${name} from ${new URL(url).host} is not the file this app expects, so it was not loaded. ` +
        "Try again later, and report it if this keeps happening.",
    );
    this.name = "IntegrityError";
  }
}

/** A file pinned by its SHA-256 digest (lowercase hex, as `sha256sum` prints it). */
export interface PinnedFile {
  url: string;
  sha256: string;
  mimeType: string;
}

/**
 * Fetches `url` and checks the bytes against the pinned SHA-256 before handing them back as a Blob.
 * A response that is not the pinned file is dropped, so nothing can go on to make it loadable.
 *
 * hash-wasm rather than Web Crypto: it is already in the bundle for lib/etag.ts, and it works on a
 * page served without a secure context, where `crypto.subtle` is undefined.
 */
export async function fetchPinned({ url, sha256: expected, mimeType }: PinnedFile): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = await sha256(bytes);
  if (actual !== expected.toLowerCase()) throw new IntegrityError(url, expected, actual);
  return new Blob([bytes], { type: mimeType });
}
