import { behAssetPath, derivativesDirectory, sourcedataDirectory, type BehEntities } from "./bidsPath";

// Where an extracted selection goes: saved to the visitor's own computer, or uploaded into the
// EMBER dandiset picked in the bottom card.
export type DeliveryMode = "download" | "upload";

/** What a single upload carries: a trimmed range, or one still frame. */
export type SelectionKind = "snippet" | "frame";

/**
 * The two directories one delivery writes into, per BEP047 (see lib/bidsPath.ts): the app's own
 * output as a `derivatives/clip-extractor/` entry, and — when the source travels along too — the
 * original it was cut from as `sourcedata/`. A saved bundle holds the exact same two directories,
 * one level inside the `.tar.gz`, so unpacking it reproduces the very tree an upload would have
 * written into the dandiset.
 */
export interface DeliveryDirectories {
  derivatives: string;
  sourcedata: string;
}

export function deliveryDirectories(entities: BehEntities): DeliveryDirectories {
  return { derivatives: derivativesDirectory(entities), sourcedata: sourcedataDirectory(entities) };
}

/** Joins a delivery directory and an already-BIDS-legal file name into the asset path to register.
 * The filenames lib/bidsPath.ts's `behFilename`/`behSidecarName` produce need no further
 * sanitization — only the directory segments might, when a subject/session label somehow still
 * carries a character a path segment cannot. */
export const uploadAssetPath = behAssetPath;

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
