// Reading and writing the three `dataset_description.json` files one delivery touches: the dataset
// root's own (BIDS's modality-agnostic file, `DatasetType: "raw"`), `derivatives/clip-extractor/`'s
// (BIDS derivatives requires every pipeline to have one), and `sourcedata/rawbids/`'s (its own
// `DatasetType: "raw"`, so that subtree validates independently — see lib/bidsPath.ts). All three
// are fixed, dataset-level files rather than per-delivery ones — unlike everything else this app
// writes, a second delivery does not get a second copy of any of them; it folds its own
// `GeneratedBy` entry (BEP028) into whichever is already there.

import type { ArchiveConfig } from "./types";
import { findExistingAsset } from "./upload";
import { DERIVATIVES_PIPELINE, SOURCEDATA_RAWBIDS } from "./bidsPath";
import {
  freshDerivativesDescription,
  freshRootDescription,
  freshSourcedataDescription,
  mergeGeneratedBy,
  type DatasetDescription,
} from "./generatedBy";

export const DATASET_DESCRIPTION_PATH = "dataset_description.json";
export const DERIVATIVES_DESCRIPTION_PATH = `derivatives/${DERIVATIVES_PIPELINE}/dataset_description.json`;
export const SOURCEDATA_DESCRIPTION_PATH = `sourcedata/${SOURCEDATA_RAWBIDS}/dataset_description.json`;

/** The three `dataset_description.json` files, wherever a delivery finds them: null for any that is
 * not registered in the dandiset yet. */
export interface ExistingDatasetDescriptions {
  root: DatasetDescription | null;
  derivatives: DatasetDescription | null;
  sourcedata: DatasetDescription | null;
}

async function readDatasetDescription(cfg: ArchiveConfig, path: string): Promise<DatasetDescription | null> {
  const asset = await findExistingAsset(cfg, path);
  if (!asset) return null;
  // The asset's own bytes, not its metadata: `findExistingAsset` only confirms the path is taken.
  const resp = await fetch(`${cfg.api}/assets/${asset.asset_id}/download/`, {
    headers: cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {},
  });
  if (!resp.ok) throw new Error(`Could not read the existing ${path} (HTTP ${resp.status}).`);
  return (await resp.json()) as DatasetDescription;
}

/** Reads whichever of the three files the destination dandiset already holds. Left to genuinely fail
 * on a network or parse error, rather than treating that the same as "not registered yet" — folding
 * this delivery's entry into a *wrongly assumed empty* file would silently erase whatever another
 * pipeline had already recorded there. */
export async function readExistingDatasetDescriptions(cfg: ArchiveConfig): Promise<ExistingDatasetDescriptions> {
  const [root, derivatives, sourcedata] = await Promise.all([
    readDatasetDescription(cfg, DATASET_DESCRIPTION_PATH),
    readDatasetDescription(cfg, DERIVATIVES_DESCRIPTION_PATH),
    readDatasetDescription(cfg, SOURCEDATA_DESCRIPTION_PATH),
  ]);
  return { root, derivatives, sourcedata };
}

/** Folds this delivery's `GeneratedBy` entry into all three files, creating any one fresh only when
 * `existing` says nothing is registered there yet — all three named after this delivery, `mode` and
 * `createdAt` (see lib/generatedBy.ts's `freshRootDescription`/`freshDerivativesDescription`/
 * `freshSourcedataDescription`). A fresh derivatives description's own `SourceDatasets` comes
 * straight off `entry.SourceVideo`, so it names the same source the sidecar files do. */
export function mergedDatasetDescriptions(
  existing: ExistingDatasetDescriptions,
  entry: import("./generatedBy").GeneratedByEntry,
  mode: "snippet" | "frame",
  createdAt: Date,
): { root: DatasetDescription; derivatives: DatasetDescription; sourcedata: DatasetDescription } {
  return {
    root: mergeGeneratedBy(existing.root, entry, freshRootDescription(mode, createdAt)),
    derivatives: mergeGeneratedBy(existing.derivatives, entry, freshDerivativesDescription(mode, createdAt, entry.SourceVideo)),
    sourcedata: mergeGeneratedBy(existing.sourcedata, entry, freshSourcedataDescription(mode, createdAt)),
  };
}
