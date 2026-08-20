import { version as TOOL_VERSION } from "../../package.json";

// BEP028-shaped provenance ("BIDS-Prov"), the convention `dataset_description.json`'s `GeneratedBy`
// key uses to record which tool produced (part of) a dataset — see
// https://github.com/bids-standard/bids-specification/blob/master/src/modality-agnostic-files/dataset_description.md
// and https://github.com/bids-standard/bids-specification/pull/487 (BEP028). The same entry shape is
// also written into every BEP047 sidecar this app produces (see lib/provenance.ts), so a single file
// carries its own provenance even apart from the dataset it sits in.

export const TOOL_NAME = "clip-extractor";
export const TOOL_CODE_URL = "https://github.com/brain-bbqs/clip-extractor";

export interface GeneratedByEntry {
  Name: string;
  Version: string;
  Description?: string;
  CodeURL?: string;
}

/** This delivery's own `GeneratedBy` entry — the same on every file it writes, since it names the
 * tool version that made them, not any one selection. */
export function buildGeneratedByEntry(): GeneratedByEntry {
  return {
    Name: TOOL_NAME,
    Version: TOOL_VERSION,
    Description: "Extracted a trimmed clip or still frame from a source video for a BIDS dataset.",
    CodeURL: TOOL_CODE_URL,
  };
}

/** Root `dataset_description.json` (BIDS's own modality-agnostic file, `DatasetType: "raw"`) versus
 * a derivatives pipeline's own (`DatasetType: "derivative"`, naming what it was generated from). */
export type DatasetType = "raw" | "derivative";

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

function sameEntry(a: GeneratedByEntry, b: GeneratedByEntry): boolean {
  return a.Name === b.Name && a.Version === b.Version;
}

/**
 * Folds this delivery's `GeneratedBy` entry into an existing (or freshly created)
 * `dataset_description.json`, without disturbing whatever else is already in it — other pipelines'
 * entries, custom keys another tool wrote, anything. An entry for the same tool at the same version
 * is left in place rather than duplicated, since it already says exactly what a new one would.
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

/** The dataset root's own `dataset_description.json`, created fresh only when none exists yet — an
 * upload never invents a dataset name or overwrites one already chosen for it. */
export function freshRootDescription(dandisetId: string): Omit<DatasetDescription, "GeneratedBy"> {
  return { Name: dandisetId, BIDSVersion: BIDS_VERSION, DatasetType: "raw" };
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
