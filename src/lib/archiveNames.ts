import type { ArchiveId } from "./archives";

// A local cache of dataset titles read out of the archives' `dandiset.jsonld` manifests.
//
// Titles are what makes the browse list searchable, and there is one small manifest per dataset to
// read them from: a few dozen for EMBER, over a thousand for DANDI. Reading them all is a minute's
// background work the first time and instant every time after, so the answers are kept here rather
// than fetched again on every visit. Only identifiers and titles are stored — both are already
// public, and nothing about the signed-in visitor goes in.

const STORAGE_KEY = "clip-extractor.archive-names.v1";

/** How long a cached set of titles is reused before it is read fresh. Datasets are renamed rarely,
 * and a stale title only affects what the filter box matches, so this is generous. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface CachedArchive {
  savedAt: number;
  names: Record<string, string>;
}

type NameCacheFile = Partial<Record<ArchiveId, CachedArchive>>;

function readFile(): NameCacheFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NameCacheFile) : {};
  } catch (e) {
    console.warn("Could not read the cached archive dataset names:", e);
    return {};
  }
}

/** The titles held for one archive, or an empty map when there are none or they have aged out. */
export function loadCachedNames(archive: ArchiveId): Map<string, string> {
  const cached = readFile()[archive];
  if (!cached || Date.now() - cached.savedAt > MAX_AGE_MS) return new Map();
  return new Map(Object.entries(cached.names));
}

/**
 * Replaces the titles held for one archive. `names` is written as-is, so a dataset that has since
 * disappeared from the bucket drops out of the cache rather than lingering in it.
 */
export function saveCachedNames(archive: ArchiveId, names: ReadonlyMap<string, string>): void {
  try {
    const file = readFile();
    file[archive] = { savedAt: Date.now(), names: Object.fromEntries(names) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch (e) {
    console.warn("Could not cache the archive dataset names:", e);
  }
}
