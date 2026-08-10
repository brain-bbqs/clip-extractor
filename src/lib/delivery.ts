import { sanitizeFilename, sanitizePath } from "./sanitize";

// Where an extracted selection goes: saved to the visitor's own computer, or uploaded into the
// EMBER dandiset picked in the bottom card.
export type DeliveryMode = "download" | "upload";

/** Every clip-extractor upload lands under this prefix, matching bbqs-uploader's `sourcedata/raw/`
 * convention for un-curated source material. */
export const UPLOAD_ROOT = "sourcedata/raw/clip-extractor";

/** The per-upload directory: one UTC timestamp per press of Upload, so a later upload of the same
 * selection never overwrites an earlier one. Colons and fractional seconds are dropped because
 * they are awkward in object keys and on Windows checkouts. */
export function uploadDirectory(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/:/g, "-");
  return `${UPLOAD_ROOT}/${stamp}`;
}

/** Joins an upload directory and a file name into the sanitized asset path to register. */
export function uploadAssetPath(directory: string, filename: string): string {
  return sanitizePath(directory, sanitizeFilename(filename));
}

/** Upload is the default whenever it is actually usable — signed in with at least one incoming
 * dataset to upload to; otherwise there is nothing to upload to and Download leads instead. */
export function defaultDeliveryMode(availableDatasets: number): DeliveryMode {
  return availableDatasets > 0 ? "upload" : "download";
}
