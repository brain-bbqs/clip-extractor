import { runQueue } from "./queue";
import { EMBER_INSTANCE } from "./instances";

// Browsing EMBER for a video to stream, without asking the archive's REST API anything.
//
// EMBER publishes, alongside the blobs themselves, a static manifest per dataset version in its
// public S3 bucket: `dandisets/<dandiset id>/<version>/dandiset.jsonld` names the dataset, and
// `dandisets/<dandiset id>/<version>/assets.jsonld` lists every file in it with its path, its size
// and the URLs its bytes can be read from. That is the whole index the public half of the browse
// pane runs on, read the same way dandi-cache/content-id-to-dandiset-paths reads DANDI's
// (`code/update.py` there), just from a browser instead of boto3: an anonymous ListObjectsV2 over
// `dandisets/` to learn what exists, then plain GETs of the manifests that matter.
//
// Reading S3 rather than the API buys two things. The manifests are static objects on a bucket
// that already serves `Access-Control-Allow-Origin: *`, so a static page can read them with no
// token, no CORS negotiation and no load on the archive's API; and the same listing that names the
// datasets also reports each manifest's byte size, which is what lets the sweep below decide up
// front whether scanning the whole archive is cheap or ruinous.
//
// An embargoed dataset is the one thing this file cannot see. Its manifests are listed in the
// public bucket but refuse anonymous reads, which is the point of an embargo — so the datasets a
// signed-in visitor owns are listed through the API instead, in lib/embargoed.ts.

export interface PublicArchive {
  label: string;
  /** Bucket name. Also how an asset's S3 `contentUrl` is told apart from its API one. */
  bucket: string;
  /** Origin the bucket is listed and read through. */
  origin: string;
  /** The archive's web UI, for linking out to a dataset's own page. */
  web: string;
}

export const EMBER_ARCHIVE: PublicArchive = {
  label: "EMBER",
  bucket: "ember-dandi-archive",
  origin: "https://ember-dandi-archive.s3.amazonaws.com",
  web: EMBER_INSTANCE.web,
};

/** Prefix every dataset manifest lives under in the bucket. */
const MANIFEST_PREFIX = "dandisets/";
const ASSETS_MANIFEST = "assets.jsonld";
const DANDISET_MANIFEST = "dandiset.jsonld";

/** S3 caps a listing page at 1000 keys; the whole archive is a page or two at that size. */
const PAGE_SIZE = 1000;

/** A backstop on the listing loop, so a continuation token that never clears cannot spin forever. */
const MAX_LIST_PAGES = 200;

/** One object in a bucket listing. */
export interface BucketEntry {
  key: string;
  size: number;
}

interface ListingPage {
  entries: BucketEntry[];
  nextToken: string | null;
}

/** Reads one ListObjectsV2 response. Exported for its own tests: the paging above it is network. */
export function parseListing(xml: string): ListingPage {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The archive's bucket listing could not be parsed as XML.");
  }
  const entries: BucketEntry[] = [];
  for (const contents of Array.from(doc.getElementsByTagName("Contents"))) {
    const key = tagText(contents, "Key");
    if (!key) continue;
    entries.push({ key, size: Number(tagText(contents, "Size") ?? 0) || 0 });
  }
  return { entries, nextToken: tagText(doc, "NextContinuationToken") };
}

/** The text of the first `tag` under `parent`, or null when there is none. The listing is in S3's
 * own namespace, which `getElementsByTagName` matches by qualified name and so ignores. */
function tagText(parent: Document | Element, tag: string): string | null {
  return parent.getElementsByTagName(tag).item(0)?.textContent || null;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`GET ${url} failed with HTTP ${resp.status}`);
  return resp.text();
}

/**
 * Every object under `dandisets/` in the archive's bucket. Anonymous and unsigned: the bucket is
 * public and answers a browser's cross-origin listing directly.
 */
export async function listManifestObjects(signal?: AbortSignal): Promise<BucketEntry[]> {
  const entries: BucketEntry[] = [];
  let token: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const params = new URLSearchParams({ "list-type": "2", prefix: MANIFEST_PREFIX, "max-keys": String(PAGE_SIZE) });
    if (token) params.set("continuation-token", token);
    const parsed = parseListing(await fetchText(`${EMBER_ARCHIVE.origin}/?${params}`, signal));
    entries.push(...parsed.entries);
    if (!parsed.nextToken) return entries;
    token = parsed.nextToken;
  }
  return entries;
}

/** One dataset in the browse list, however it was found. */
export interface ArchiveDandiset {
  /** Zero-padded dandiset identifier, e.g. `000265`. */
  id: string;
  /** The version whose manifests are read. Always `draft` for an embargoed dataset. */
  version: string;
  /** Byte size of that version's `assets.jsonld`, from the listing. Zero for an embargoed dataset,
   * whose file list comes from the API rather than a manifest. */
  manifestBytes: number;
  /** Whether the dataset is embargoed, and so listed through the API against a signed-in owner. */
  embargoed: boolean;
  /** Known up front only for an embargoed dataset, whose API listing carries its title. */
  name?: string;
}

/**
 * Which version of a dataset to read. `draft` is preferred wherever it exists — every dataset in
 * the archive has one, and it tracks what the dataset holds *now*, so a video uploaded since the
 * last publication is still offered. Published versions are named `0.<date>.<time>`, which sorts
 * chronologically as text, so the last one is the newest.
 */
export function pickManifestVersion(versions: readonly string[]): string | null {
  if (versions.includes("draft")) return "draft";
  return versions.length ? [...versions].sort().at(-1)! : null;
}

/** Folds a bucket listing into one entry per dataset, ordered by identifier. */
export function indexDandisets(entries: readonly BucketEntry[]): ArchiveDandiset[] {
  // key layout: `dandisets/<dandiset id>/<version>/<manifest name>`, matching update.py's split.
  const byId = new Map<string, Map<string, number>>();
  for (const { key, size } of entries) {
    const parts = key.split("/");
    if (parts.length !== 4 || parts[0] !== "dandisets" || parts[3] !== ASSETS_MANIFEST) continue;
    const versions = byId.get(parts[1]) ?? new Map<string, number>();
    versions.set(parts[2], size);
    byId.set(parts[1], versions);
  }
  const datasets: ArchiveDandiset[] = [];
  for (const [id, versions] of byId) {
    const version = pickManifestVersion([...versions.keys()]);
    if (version) datasets.push({ id, version, manifestBytes: versions.get(version) ?? 0, embargoed: false });
  }
  return datasets.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Merges the datasets a signed-in visitor owns into the public listing. An embargoed dataset is
 * listed in the public bucket too — only its manifests refuse to be read — so it would otherwise
 * appear twice, once as itself and once as a dataset that looks empty because nothing about it
 * could be read. The owned entry wins.
 */
export function mergeDandisets(pub: readonly ArchiveDandiset[], owned: readonly ArchiveDandiset[]): ArchiveDandiset[] {
  const byId = new Map(pub.map((d) => [d.id, d]));
  for (const dataset of owned) byId.set(dataset.id, dataset);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function manifestUrl(dandiset: ArchiveDandiset, name: string): string {
  return `${EMBER_ARCHIVE.origin}/${MANIFEST_PREFIX}${dandiset.id}/${dandiset.version}/${name}`;
}

async function fetchManifest(url: string, signal?: AbortSignal): Promise<unknown> {
  return JSON.parse(await fetchText(url, signal)) as unknown;
}

/**
 * A dataset's title, from its `dandiset.jsonld`. Returns null rather than throwing when the
 * manifest cannot be read, so one unreadable title leaves the rest of the list alone.
 */
export async function fetchDandisetName(dandiset: ArchiveDandiset, signal?: AbortSignal): Promise<string | null> {
  try {
    const doc = (await fetchManifest(manifestUrl(dandiset, DANDISET_MANIFEST), signal)) as { name?: unknown };
    return typeof doc.name === "string" && doc.name ? doc.name : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn(`Could not read the name of EMBER dandiset ${dandiset.id}:`, e);
    return null;
  }
}

/** A video file in the archive, ready to be streamed. */
export interface ArchiveVideo {
  dandisetId: string;
  /** Path within the dataset, e.g. `sub-1/mice.mp4`. */
  path: string;
  /** Bytes, or null when neither the manifest nor the API says. */
  size: number | null;
  /** The archive's own citable URL for the asset, recorded as the clip's source. */
  assetUrl: string;
  /** The bucket URL the frames are read from. Null for an embargoed asset, whose bucket URL has to
   * be signed for on demand (see lib/embargoed.ts). */
  streamUrl: string | null;
  embargoed: boolean;
}

/** Containers worth offering as video. Matched on the path, since a manifest's `encodingFormat` is
 * only as good as whatever wrote it, and checked against it too for the ones that fill it in. */
const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "avi", "mkv", "webm", "mpg", "mpeg", "ogv", "wmv"];

export function isVideoAsset(path: string, encodingFormat?: unknown): boolean {
  if (typeof encodingFormat === "string" && encodingFormat.startsWith("video/")) return true;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTENSIONS.includes(ext);
}

interface AssetManifestEntry {
  path?: unknown;
  contentSize?: unknown;
  contentUrl?: unknown;
  encodingFormat?: unknown;
}

/**
 * Every video in one parsed `assets.jsonld`.
 *
 * An asset carries several `contentUrl`s for the same bytes: the archive's API download endpoint,
 * and the direct S3 object. The S3 one is what the player streams from, because it answers range
 * requests cross-origin without a redirect through an API host; the API one is what the provenance
 * sidecar records, because it is the URL that names the asset rather than its content hash. Picked
 * by which bucket a URL points at rather than by position, unlike update.py's fixed `[1]`, since a
 * browser has to survive an asset whose URLs are listed in another order.
 */
export function selectVideoAssets(dandisetId: string, manifest: unknown): ArchiveVideo[] {
  if (!Array.isArray(manifest)) return [];
  const videos: ArchiveVideo[] = [];
  for (const entry of manifest as unknown[]) {
    const raw = (entry ?? {}) as AssetManifestEntry;
    const path = typeof raw.path === "string" ? raw.path : "";
    if (!path || !isVideoAsset(path, raw.encodingFormat)) continue;
    const urls = (Array.isArray(raw.contentUrl) ? raw.contentUrl : []).filter((u): u is string => typeof u === "string");
    const streamUrl = urls.find((u) => isBucketUrl(u, EMBER_ARCHIVE.bucket));
    if (!streamUrl) continue;
    videos.push({
      dandisetId,
      path,
      size: typeof raw.contentSize === "number" ? raw.contentSize : null,
      assetUrl: urls.find((u) => u !== streamUrl) ?? streamUrl,
      streamUrl,
      embargoed: false,
    });
  }
  return videos.sort((a, b) => a.path.localeCompare(b.path));
}

function isBucketUrl(url: string, bucket: string): boolean {
  try {
    return new URL(url).hostname.startsWith(`${bucket}.s3.`);
  } catch {
    return false;
  }
}

/** Every video in one public dataset. */
export async function fetchDandisetVideos(dandiset: ArchiveDandiset, signal?: AbortSignal): Promise<ArchiveVideo[]> {
  const manifest = await fetchManifest(manifestUrl(dandiset, ASSETS_MANIFEST), signal);
  return selectVideoAssets(dandiset.id, manifest);
}

/**
 * How much `assets.jsonld` a whole-archive sweep may read. EMBER's manifests come to a third of a
 * megabyte across every dataset it holds, so sweeping it up front and showing only the datasets
 * that actually contain video costs one short pause. The listing reports every manifest's size, so
 * whether that still holds is measured on each visit rather than assumed.
 */
export const SWEEP_BUDGET_BYTES = 32 * 1024 * 1024;

/** Manifests read at once during a sweep. Small files on a bucket, so the limit is about being a
 * considerate client rather than about local work. */
const SWEEP_CONCURRENCY = 8;

export function sweepBytes(datasets: readonly ArchiveDandiset[]): number {
  return datasets.reduce((total, d) => total + d.manifestBytes, 0);
}

export function canSweep(datasets: readonly ArchiveDandiset[]): boolean {
  return sweepBytes(datasets) <= SWEEP_BUDGET_BYTES;
}

/**
 * Reads every dataset's file list and reports the videos it holds, calling `onDataset` as each one
 * lands so a caller can fill a list in as it goes. A dataset whose list cannot be read reports no
 * videos rather than failing the sweep.
 *
 * `read` is passed in rather than fixed, because a public dataset's file list comes from a manifest
 * on the bucket and an embargoed one's comes from the API — and the pane holds both in one list.
 */
export async function sweepArchiveVideos(
  datasets: readonly ArchiveDandiset[],
  read: (dandiset: ArchiveDandiset, signal?: AbortSignal) => Promise<ArchiveVideo[]>,
  onDataset: (dandiset: ArchiveDandiset, videos: ArchiveVideo[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runQueue(datasets, SWEEP_CONCURRENCY, async (dandiset) => {
    let videos: ArchiveVideo[] = [];
    try {
      videos = await read(dandiset, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn(`Could not read the file list of EMBER dandiset ${dandiset.id}:`, e);
    }
    onDataset(dandiset, videos);
  });
}

/** Fills in the names of the datasets it is handed, calling `onName` as each one arrives. */
export async function hydrateDandisetNames(
  datasets: readonly ArchiveDandiset[],
  onName: (dandiset: ArchiveDandiset, name: string | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runQueue(datasets, SWEEP_CONCURRENCY, async (dandiset) => {
    onName(dandiset, await fetchDandisetName(dandiset, signal));
  });
}

/** The dataset's own page in the archive's web UI. */
export function dandisetWebUrl(dandiset: ArchiveDandiset): string {
  return `${EMBER_ARCHIVE.web}/dandiset/${dandiset.id}/${dandiset.version}`;
}
