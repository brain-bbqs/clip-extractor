import { sanitizeFilename, sanitizePath, verbatimFilename } from "./sanitize";

// Where an extracted selection goes: saved to the visitor's own computer, or uploaded into the
// EMBER dandiset picked in the bottom card.
export type DeliveryMode = "download" | "upload";

/** Every clip-extractor upload lands under this prefix, matching bbqs-uploader's `sourcedata/raw/`
 * convention for un-curated source material. */
export const UPLOAD_ROOT = "sourcedata/raw/clip-extractor";

/** What a single upload carries: a trimmed range, or one still frame. */
export type SelectionKind = "snippet" | "frame";

/** The per-upload directory, named in the same BIDS entity style as the files inside it:
 * `date-YYYYMMDD_time-HHMMSS_type-<snippet|frame>`. One timestamp per press of Upload, so a later
 * upload of the same selection never overwrites an earlier one, and the `type-` entity lets a
 * listing be read at a glance.
 *
 * Both stamps are digits only — no separators, and no `Z`, even though the clock is UTC. The exact
 * instant, timezone designator and all, is recorded as `created_at` in the provenance sidecar. */
export function uploadDirectory(now: Date, kind: SelectionKind): string {
  // toISOString is fixed-width (YYYY-MM-DDTHH:MM:SS.sssZ), so these slices are stable.
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${UPLOAD_ROOT}/date-${date}_time-${time}_type-${kind}`;
}

/** Joins an upload directory and a file name into the sanitized asset path to register. */
export function uploadAssetPath(directory: string, filename: string): string {
  return sanitizePath(directory, sanitizeFilename(filename));
}

/** Same, but leaving the file name exactly as it arrived — for the original video, which is
 * uploaded untouched rather than renamed. */
export function uploadOriginalPath(directory: string, filename: string): string {
  return sanitizePath(directory, verbatimFilename(filename));
}

/** A deep link into the archive's file browser, opened straight at an upload's own directory rather
 * than the dandiset's landing page. Mirrors the route the archive web app itself uses:
 * `/dandiset/<id>/<version>/files?location=<path>` (dandi/dandi-archive web/src/router). */
export function fileBrowserUrl(web: string, dandisetId: string, directory: string): string {
  return `${web}/dandiset/${dandisetId}/draft/files?location=${encodeURIComponent(directory)}`;
}

/** Upload is the default whenever it is actually usable — signed in with at least one incoming
 * dataset to upload to; otherwise there is nothing to upload to and Download leads instead. */
export function defaultDeliveryMode(availableDatasets: number): DeliveryMode {
  return availableDatasets > 0 ? "upload" : "download";
}
