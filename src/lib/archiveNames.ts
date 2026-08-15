// A local cache of dataset titles read out of EMBER's `dandiset.jsonld` manifests.
//
// Titles are what makes the browse list searchable, and there is one small manifest per dataset to
// read them from. Reading them all is a short pause the first time and nothing at all every time
// after, so the answers are kept here rather than fetched again on every visit. Only identifiers
// and titles of *public* datasets are stored — both are already public, and nothing about the
// signed-in visitor or the datasets they own goes in.

const STORAGE_KEY = "clip-extractor.archive-names.v1";

/** How long a cached set of titles is reused before it is read fresh. Datasets are renamed rarely,
 * and a stale title only affects what the filter box matches, so this is generous. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface NameCacheFile {
  savedAt?: number;
  names?: Record<string, string>;
}

function readFile(): NameCacheFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NameCacheFile) : {};
  } catch (e) {
    console.warn("Could not read the cached dataset names:", e);
    return {};
  }
}

/** The titles held, or an empty map when there are none or they have aged out. */
export function loadCachedNames(): Map<string, string> {
  const cached = readFile();
  if (!cached.names || !cached.savedAt || Date.now() - cached.savedAt > MAX_AGE_MS) return new Map();
  return new Map(Object.entries(cached.names));
}

/**
 * Replaces the titles held. `names` is written as-is, so a dataset that has since disappeared from
 * the bucket drops out of the cache rather than lingering in it.
 */
export function saveCachedNames(names: ReadonlyMap<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), names: Object.fromEntries(names) }));
  } catch (e) {
    console.warn("Could not cache the dataset names:", e);
  }
}
