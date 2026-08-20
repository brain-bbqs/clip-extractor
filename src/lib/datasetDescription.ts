// Reading and writing the two `dataset_description.json` files one delivery touches: the dataset
// root's own (BIDS's modality-agnostic file, `DatasetType: "raw"`) and
// `derivatives/clip-extractor/dataset_description.json` (BIDS derivatives requires every pipeline
// to have one). Both are fixed, dataset-level files rather than per-delivery ones — unlike
// everything else this app writes, a second delivery does not get a second copy of either; it folds
// its own `GeneratedBy` entry (BEP028) into whichever one is already there.

import type { ArchiveConfig } from "./types";
import { findExistingAsset } from "./upload";
import { DERIVATIVES_PIPELINE } from "./bidsPath";
import { freshDerivativesDescription, freshRootDescription, mergeGeneratedBy, type DatasetDescription } from "./generatedBy";

export const DATASET_DESCRIPTION_PATH = "dataset_description.json";
export const DERIVATIVES_DESCRIPTION_PATH = `derivatives/${DERIVATIVES_PIPELINE}/dataset_description.json`;

/** The two `dataset_description.json` files, wherever a delivery finds them: null for either that
 * is not registered in the dandiset yet. */
export interface ExistingDatasetDescriptions {
  root: DatasetDescription | null;
  derivatives: DatasetDescription | null;
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

/** Reads whichever of the two files the destination dandiset already holds. Left to genuinely fail
 * on a network or parse error, rather than treating that the same as "not registered yet" — folding
 * this delivery's entry into a *wrongly assumed empty* file would silently erase whatever another
 * pipeline had already recorded there. */
export async function readExistingDatasetDescriptions(cfg: ArchiveConfig): Promise<ExistingDatasetDescriptions> {
  const [root, derivatives] = await Promise.all([
    readDatasetDescription(cfg, DATASET_DESCRIPTION_PATH),
    readDatasetDescription(cfg, DERIVATIVES_DESCRIPTION_PATH),
  ]);
  return { root, derivatives };
}

/** Folds this delivery's `GeneratedBy` entry into both files, creating either one fresh only when
 * `existing` says nothing is registered there yet. */
export function mergedDatasetDescriptions(
  existing: ExistingDatasetDescriptions,
  entry: import("./generatedBy").GeneratedByEntry,
  dandisetId: string,
): { root: DatasetDescription; derivatives: DatasetDescription } {
  return {
    root: mergeGeneratedBy(existing.root, entry, freshRootDescription(dandisetId)),
    derivatives: mergeGeneratedBy(existing.derivatives, entry, freshDerivativesDescription(dandisetId)),
  };
}
