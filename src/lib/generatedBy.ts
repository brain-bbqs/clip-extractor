import { version as TOOL_VERSION } from "../../package.json";

// BEP028-shaped provenance ("BIDS-Prov"), the convention `dataset_description.json`'s `GeneratedBy`
// key uses to record which tool produced (part of) a dataset — see
// https://github.com/bids-standard/bids-specification/blob/master/src/modality-agnostic-files/dataset_description.md
// and https://github.com/bids-standard/bids-specification/pull/487 (BEP028). It is recorded once per
// dataset, in the three `dataset_description.json` files a delivery touches, and nowhere else: the
// BEP047 sidecars this app writes beside each file (see lib/provenance.ts) deliberately carry no
// `GeneratedBy` of their own, since repeating the same entry on every file would only restate what
// the dataset already says about which tool produced it.

export const TOOL_NAME = "clip-extractor";
export const TOOL_CODE_URL = "https://github.com/brain-bbqs/clip-extractor";

// Field order below (Name, then Description, then the version-y stuff) is deliberate, not just
// declaration order: object literals preserve insertion order through JSON.stringify, and every
// dataset_description.json/sidecar this app writes reads Name and Description first, before anything
// about versions or provenance detail, for the same reason a file's own header reads that way.
export interface GeneratedByEntry {
  Name: string;
  Description?: string;
  Version: string;
  CodeURL?: string;
}

/** This delivery's own `GeneratedBy` entry — identical on every file it writes and across every
 * delivery of the same tool version, deduplicated to one entry per version rather than one per
 * delivery (see `mergeGeneratedBy` below). Which source videos this tool version actually ran
 * against is `SourceDatasets`' own job to record instead (see `mergeSourceDataset`, which — unlike
 * `GeneratedBy` — accumulates one entry per distinct video across repeat deliveries): BEP028 does not
 * define a field on `GeneratedBy` for naming an individual input file, so this app no longer invents
 * one there. */
export function buildGeneratedByEntry(): GeneratedByEntry {
  return {
    Name: TOOL_NAME,
    Description: "Extracted a trimmed clip or still frame from a source video.",
    Version: TOOL_VERSION,
    CodeURL: TOOL_CODE_URL,
  };
}

/** Root `dataset_description.json` (BIDS's own modality-agnostic file), the derivatives pipeline's
 * own (`DatasetType: "derivative"`, naming what it was generated from), or `sourcedata/rawbids/`'s
 * own (`DatasetType: "raw"`). `"study"` is BIDS's own type for a root that organizes source, raw and
 * derived data together under one dataset, which is exactly this app's own tree. */
export type DatasetType = "raw" | "derivative" | "study";

/** One entry of `SourceDatasets` — BIDS's own `URL`/`DOI`/`Version`, all themselves optional, and
 * nothing this app invented beside them. It names a *dataset*, which is what BIDS means by the
 * field: this app builds one only when the source video came out of a dandiset, naming that
 * dandiset's own URL (see lib/provenance.ts's `buildSourceDatasetEntry`), and none at all for a
 * locally dropped file, which belongs to no dataset to name. */
export interface SourceDatasetEntry {
  URL?: string;
  DOI?: string;
  Version?: string;
  /** Where the source video sat inside that dataset, archive-relative. Not part of the vocabulary
   * BIDS defines for this object — the entry it belongs to still names a dataset, as BIDS means it,
   * and this only says which of its assets was actually read. */
  Path?: string;
}

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
  SourceDatasets?: SourceDatasetEntry[];
  /** BIDS's own field for who to credit. This app only ever contributes a minimal entry — the
   * signed-in archive username, when there is one (see `mergeAuthor`) — rather than asking for a
   * real name nobody typed in, so it names who ran the delivery without inventing detail it does not
   * have. */
  Authors?: string[];
  /** BIDS's own alias table for pointing at another dataset by a short key instead of a full relative
   * path — the study root names its own `derivatives/clip-extractor/` under `clip` and
   * `sourcedata/rawbids/` under `source`, and `derivatives/clip-extractor/`'s own file names
   * `sourcedata/rawbids/` back under `raw` (see `mergeDatasetLinks` and
   * lib/datasetDescription.ts's `mergedDatasetDescriptions`), so a reference elsewhere in the dataset
   * (`bids::clip/...`/`bids::raw/...`/`bids::source/...`) does not have to spell any of the three
   * paths out in full. */
  DatasetLinks?: Record<string, string>;
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
 * is left in place rather than duplicated (saving a bundle and then uploading it, say, or a second
 * delivery of a different video at the same tool version) — see `mergeSourceDataset` for what tracks
 * *which* videos this tool version actually ran against, which `GeneratedBy` itself no longer does.
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

/** Whichever of URL or DOI actually identifies a `SourceDatasets` entry's dataset — the first that
 * is known, in that order of how well it resolves to the dataset itself. */
function sourceIdentity(s: SourceDatasetEntry): string {
  return s.URL ?? s.DOI ?? "";
}

/** Adds `source` to `doc.SourceDatasets`, unless a dataset with the same identity (see
 * `sourceIdentity`) is already listed — so repeat deliveries out of one dandiset share its single
 * entry, while a second dandiset processed by the same pipeline gets its own rather than being lost
 * the way a fixed, write-once `SourceDatasets` would lose it. `source: null` (this delivery's video
 * came from no dataset — a locally dropped file) leaves `doc` untouched. */
export function mergeSourceDataset(doc: DatasetDescription, source: SourceDatasetEntry | null): DatasetDescription {
  if (!source || !Object.keys(source).length) return doc;
  const sources = doc.SourceDatasets ?? [];
  const already = sources.some((s) => sourceIdentity(s) === sourceIdentity(source));
  return already ? doc : { ...doc, SourceDatasets: [...sources, source] };
}

/** Credits the signed-in archive username on `doc`, alongside whoever is already listed there —
 * appended rather than replacing, and left alone (not even the field added) once it is already
 * present, since re-delivering the same selection is not a second contribution to credit. A local
 * Save, or an upload nobody signed in for by the time this runs, passes `username: null` and leaves
 * `doc` untouched: crediting no one is more honest than a placeholder. */
export function mergeAuthor(doc: DatasetDescription, username: string | null): DatasetDescription {
  if (!username) return doc;
  const authors = doc.Authors ?? [];
  return authors.includes(username) ? doc : { ...doc, Authors: [...authors, username] };
}

/** Adds (or keeps) one `key: target` alias in `doc.DatasetLinks`, without disturbing whatever other
 * aliases — another pipeline's, or this app's own other one — are already there. Idempotent, like
 * `mergeAuthor` — a re-delivery that finds the alias already correct leaves `doc` untouched rather
 * than rewriting it. */
export function mergeDatasetLinks(doc: DatasetDescription, key: string, target: string): DatasetDescription {
  const links = doc.DatasetLinks ?? {};
  if (links[key] === target) return doc;
  return { ...doc, DatasetLinks: { ...links, [key]: target } };
}

/** Capitalized, for a human-readable `Name`. */
function selectionLabel(mode: "snippet" | "frame"): string {
  return mode === "frame" ? "Frame" : "Snippet";
}

/** The study's own name — shared, verbatim or with a parenthetical suffix, by all three
 * `dataset_description.json` files a delivery may create fresh, so the three read as one related
 * set rather than three independently named datasets.
 *
 * Deliberately carries no timestamp. These three files are dataset-level, not per-delivery: the
 * first delivery to find one missing creates it and every later one folds into what is already
 * there (see `mergeGeneratedBy`), so a name stamped with whichever moment happened to be first
 * would sit there permanently describing an instant that means nothing to everything added after
 * it. The delivery-level record of *when* lives where it belongs — the `date-`/`time-` directory
 * each delivery's own derivatives sit in (see lib/bidsPath.ts). */
function studyName(mode: "snippet" | "frame"): string {
  return `${selectionLabel(mode)} extracted using the Clip Extractor`;
}

/** The dataset root's own `dataset_description.json`, created fresh only when none exists yet — an
 * upload never invents a dataset name or overwrites one already chosen for it. Named after the
 * delivery that created it, since nothing else (a dandiset has no name of its own worth quoting
 * here) says more about what this app put there. `DatasetType: "study"`: this root organizes source
 * (`sourcedata/rawbids/`), raw derivatives inputs, and derived output (`derivatives/`) together, per
 * BIDS's own convention for that. */
export function freshRootDescription(mode: "snippet" | "frame"): Omit<DatasetDescription, "GeneratedBy"> {
  return { Name: studyName(mode), BIDSVersion: BIDS_VERSION, DatasetType: "study" };
}

/** `derivatives/clip-extractor/dataset_description.json` — the pipeline's own, required by BIDS
 * derivatives regardless of what (if anything) the raw dataset's own file says. Its `SourceDatasets`
 * is not set here — a delivery folds its own entry in afterwards via `mergeSourceDataset`, the same
 * way `GeneratedBy` and `Authors` are folded in rather than written once at creation. The `Name`
 * matches the study's own, so the two read as the same delivery's two halves rather than unrelated
 * datasets. */
export function freshDerivativesDescription(mode: "snippet" | "frame"): Omit<DatasetDescription, "GeneratedBy"> {
  return { Name: `${studyName(mode)} (Extracted)`, BIDSVersion: BIDS_VERSION, DatasetType: "derivative" };
}

/** `sourcedata/rawbids/dataset_description.json` — its own `DatasetType: "raw"`, so
 * `sourcedata/rawbids/` validates on its own as a complete BIDS dataset, independent of the dandiset
 * it sits inside (see lib/bidsPath.ts's module comment). */
export function freshSourcedataDescription(mode: "snippet" | "frame"): Omit<DatasetDescription, "GeneratedBy"> {
  return { Name: `${studyName(mode)} (Original)`, BIDSVersion: BIDS_VERSION, DatasetType: "raw" };
}
