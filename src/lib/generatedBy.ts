import { version as TOOL_VERSION } from "../../package.json";

// BEP028-shaped provenance ("BIDS-Prov"), the convention `dataset_description.json`'s `GeneratedBy`
// key uses to record which tool produced (part of) a dataset — see
// https://github.com/bids-standard/bids-specification/blob/master/src/modality-agnostic-files/dataset_description.md
// and https://github.com/bids-standard/bids-specification/pull/487 (BEP028). The same entry shape is
// also written into every BEP047 sidecar this app produces (see lib/provenance.ts), so a single file
// carries its own provenance even apart from the dataset it sits in.

export const TOOL_NAME = "clip-extractor";
export const TOOL_CODE_URL = "https://github.com/brain-bbqs/clip-extractor";

/** As much as is known about the source video a `GeneratedBy` entry's own delivery cut a selection
 * out of — the same information as the sidecar's own `source_video` block (see lib/provenance.ts's
 * `ProvenanceSource`), duplicated here so the dataset-level files carry it too, not just the file it
 * was extracted into. */
export interface GeneratedBySourceVideo {
  filename: string;
  url: string | null;
  size_bytes: number | null;
  checksum: { algorithm: "dandi:dandi-etag"; value: string } | null;
  checksum_unavailable: string | null;
  fps: number;
  width: number;
  height: number;
  num_frames: number;
}

export interface GeneratedByEntry {
  Name: string;
  Version: string;
  Description?: string;
  CodeURL?: string;
  /** Omitted only for an entry recorded some other way than a real delivery — every one this app
   * writes carries one. */
  SourceVideo?: GeneratedBySourceVideo;
}

/** This delivery's own `GeneratedBy` entry — the same on every file it writes, except that its
 * `SourceVideo`, when given, is what tells two deliveries of two different videos, at the same tool
 * version, apart (see `mergeGeneratedBy` below) rather than being collapsed into one. Passed only
 * where a `GeneratedBy` array actually accumulates across deliveries — the three
 * `dataset_description.json` files (see lib/datasetDescription.ts) — since a single file's own
 * sidecar already names its source video in full, without needing it repeated here too. */
export function buildGeneratedByEntry(sourceVideo?: GeneratedBySourceVideo): GeneratedByEntry {
  return {
    Name: TOOL_NAME,
    Version: TOOL_VERSION,
    Description: "Extracted a trimmed clip or still frame from a source video for a BIDS dataset.",
    CodeURL: TOOL_CODE_URL,
    ...(sourceVideo ? { SourceVideo: sourceVideo } : {}),
  };
}

/** Root `dataset_description.json` (BIDS's own modality-agnostic file), the derivatives pipeline's
 * own (`DatasetType: "derivative"`, naming what it was generated from), or `sourcedata/rawbids/`'s
 * own (`DatasetType: "raw"`). `"study"` is BIDS's own type for a root that organizes source, raw and
 * derived data together under one dataset, which is exactly this app's own tree. */
export type DatasetType = "raw" | "derivative" | "study";

// No index signature here deliberately: combined with `Omit`, one turns every field's type into the
// index signature's own (a known TypeScript quirk), which is exactly what `mergeGeneratedBy` below
// needs to avoid. A `dataset_description.json` this app did not write may still carry other keys —
// SourceDatasets, License, whatever a curator or another pipeline added — but those pass through
// untouched via `existing`/the object spread rather than needing a name here.
export interface DatasetDescription {
  Name: string;
  BIDSVersion: string;
  DatasetType: DatasetType;
  GeneratedBy?: GeneratedByEntry[];
  /** BIDS derivatives' own field naming where a derivative pipeline's content came from — set only
   * on `derivatives/clip-extractor/dataset_description.json`, not the dataset root's. */
  SourceDatasets?: { URL: string }[];
}

/** The BIDS version these sidecars and `dataset_description.json` files are written against. */
export const BIDS_VERSION = "1.10.0";

/** Whichever of checksum, URL or filename actually identifies the video — the first that is known,
 * in that order of how well it actually distinguishes one video from another. */
function videoIdentity(v: GeneratedBySourceVideo | undefined): string {
  return v?.checksum?.value ?? v?.url ?? v?.filename ?? "";
}

function sameEntry(a: GeneratedByEntry, b: GeneratedByEntry): boolean {
  return a.Name === b.Name && a.Version === b.Version && videoIdentity(a.SourceVideo) === videoIdentity(b.SourceVideo);
}

/**
 * Folds this delivery's `GeneratedBy` entry into an existing (or freshly created)
 * `dataset_description.json`, without disturbing whatever else is already in it — other pipelines'
 * entries, custom keys another tool wrote, anything. An entry for the same tool at the same version
 * *and* the same source video is left in place rather than duplicated (saving a bundle and then
 * uploading it, say), but a second video at the same tool version gets its own entry — otherwise the
 * array would read as "this tool ran once" no matter how many different videos it actually processed.
 */
export function mergeGeneratedBy(
  existing: DatasetDescription | null,
  entry: GeneratedByEntry,
  fallback: Omit<DatasetDescription, "GeneratedBy">,
): DatasetDescription {
  const base: DatasetDescription = existing ?? fallback;
  const generatedBy = base.GeneratedBy ?? [];
  const already = generatedBy.some((g) => sameEntry(g, entry));
  return { ...base, GeneratedBy: already ? generatedBy : [...generatedBy, entry] };
}

/** Capitalized, for a human-readable `Name`. */
function selectionLabel(mode: "snippet" | "frame"): string {
  return mode === "frame" ? "Frame" : "Snippet";
}

/** The dataset root's own `dataset_description.json`, created fresh only when none exists yet — an
 * upload never invents a dataset name or overwrites one already chosen for it. Named after the
 * delivery that created it, since nothing else (a dandiset has no name of its own worth quoting
 * here) says more about what this app put there. `DatasetType: "study"`: this root organizes source
 * (`sourcedata/rawbids/`), raw derivatives inputs, and derived output (`derivatives/`) together, per
 * BIDS's own convention for that. */
export function freshRootDescription(mode: "snippet" | "frame", createdAt: Date): Omit<DatasetDescription, "GeneratedBy"> {
  return {
    Name: `${selectionLabel(mode)} extracted using the Clip Extractor on ${createdAt.toISOString()}`,
    BIDSVersion: BIDS_VERSION,
    DatasetType: "study",
  };
}

/** `derivatives/clip-extractor/dataset_description.json` — the pipeline's own, required by BIDS
 * derivatives regardless of what (if anything) the raw dataset's own file says. `SourceDatasets`
 * names where the derivative content came from. */
export function freshDerivativesDescription(dandisetId: string): Omit<DatasetDescription, "GeneratedBy"> {
  return {
    Name: `${TOOL_NAME} derivatives of ${dandisetId}`,
    BIDSVersion: BIDS_VERSION,
    DatasetType: "derivative",
    SourceDatasets: [{ URL: `.` }],
  };
}

/** `sourcedata/rawbids/dataset_description.json` — its own `DatasetType: "raw"`, so
 * `sourcedata/rawbids/` validates on its own as a complete BIDS dataset, independent of the dandiset
 * it sits inside (see lib/bidsPath.ts's module comment). */
export function freshSourcedataDescription(dandisetId: string): Omit<DatasetDescription, "GeneratedBy"> {
  return { Name: `${dandisetId} sourcedata (raw BIDS)`, BIDSVersion: BIDS_VERSION, DatasetType: "raw" };
}
