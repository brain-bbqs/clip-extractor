import { runQueue } from "./queue";

// Browsing the public EMBER and DANDI archives for a video to stream, without asking either
// archive's REST API anything.
//
// Both archives publish, alongside the blobs themselves, a static manifest per dataset version in
// their public S3 bucket: `dandisets/<dandiset id>/<version>/dandiset.jsonld` names the dataset,
// and `dandisets/<dandiset id>/<version>/assets.jsonld` lists every file in it with its path, its
// size and the URLs its bytes can be read from. That is the whole index this pane runs on, read
// the same way dandi-cache/content-id-to-dandiset-paths reads it (`code/update.py` there), just
// from a browser instead of boto3: an anonymous ListObjectsV2 over `dandisets/` to learn what
// exists, then plain GETs of the manifests that matter.
//
// Reading S3 rather than the API buys two things. The manifests are static objects on a bucket
// that already serves `Access-Control-Allow-Origin: *`, so a static page can read them with no
// token, no CORS negotiation and no load on an archive's API; and the same listing that names the
// datasets also reports each manifest's byte size, which is what lets the sweep below decide up
// front whether scanning a whole archive is cheap or ruinous.

export type ArchiveId = "ember" | "dandi";

export interface PublicArchive {
  id: ArchiveId;
  label: string;
  /** Bucket name. Also how an asset's S3 `contentUrl` is told apart from its API one. */
  bucket: string;
  /** Origin the bucket is listed and read through (region-qualified where the bucket needs it). */
  origin: string;
  /** The archive's web UI, for linking out to a dataset's own page. */
  web: string;
}

export const PUBLIC_ARCHIVES: readonly PublicArchive[] = [
  {
    id: "ember",
    label: "EMBER",
    bucket: "ember-dandi-archive",
    origin: "https://ember-dandi-archive.s3.amazonaws.com",
    web: "https://dandi.emberarchive.org",
  },
  {
    id: "dandi",
    label: "DANDI",
    bucket: "dandiarchive",
    // us-east-2, unlike the blob `contentUrl`s the manifests carry, which name the bucket without
    // a region. Listing is the only call that needs the regional host.
    origin: "https://dandiarchive.s3.us-east-2.amazonaws.com",
    web: "https://dandiarchive.org",
  },
];

export function archiveById(id: ArchiveId): PublicArchive {
  const archive = PUBLIC_ARCHIVES.find((a) => a.id === id);
  if (!archive) throw new Error(`Unknown archive "${id}"`);
  return archive;
}

/** Prefix every dataset manifest lives under, in both archives' buckets. */
const MANIFEST_PREFIX = "dandisets/";
const ASSETS_MANIFEST = "assets.jsonld";
const DANDISET_MANIFEST = "dandiset.jsonld";

/** S3 caps a listing page at 1000 keys; a full archive is a handful of pages at that size. */
const PAGE_SIZE = 1000;

/** A backstop on the listing loop, so a continuation token that never clears cannot spin forever.
 * DANDI, the larger archive by far, lists in nine pages. */
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
 * Every object under `dandisets/` in an archive's bucket. Anonymous and unsigned: both buckets are
 * public and answer a browser's cross-origin listing directly.
 */
export async function listManifestObjects(archive: PublicArchive, signal?: AbortSignal): Promise<BucketEntry[]> {
  const entries: BucketEntry[] = [];
  let token: string | null = null;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const params = new URLSearchParams({ "list-type": "2", prefix: MANIFEST_PREFIX, "max-keys": String(PAGE_SIZE) });
    if (token) params.set("continuation-token", token);
    const parsed = parseListing(await fetchText(`${archive.origin}/?${params}`, signal));
    entries.push(...parsed.entries);
    if (!parsed.nextToken) return entries;
    token = parsed.nextToken;
  }
  return entries;
}

/** One dataset, as the bucket listing alone describes it. */
export interface ArchiveDandiset {
  /** Zero-padded dandiset identifier, e.g. `000265`. */
  id: string;
  /** The version whose manifests are read. */
  version: string;
  /** Byte size of that version's `assets.jsonld`, straight from the listing. */
  manifestBytes: number;
}

/**
 * Which version of a dataset to read. `draft` is preferred wherever it exists — every dataset in
 * both archives has one, and it tracks what the dataset holds *now*, so a video uploaded since the
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
    if (version) datasets.push({ id, version, manifestBytes: versions.get(version) ?? 0 });
  }
  return datasets.sort((a, b) => a.id.localeCompare(b.id));
}

function manifestUrl(archive: PublicArchive, dandiset: ArchiveDandiset, name: string): string {
  return `${archive.origin}/${MANIFEST_PREFIX}${dandiset.id}/${dandiset.version}/${name}`;
}

async function fetchManifest(url: string, signal?: AbortSignal): Promise<unknown> {
  return JSON.parse(await fetchText(url, signal)) as unknown;
}

/**
 * A dataset's title, from its `dandiset.jsonld`. Returns null rather than throwing when the
 * manifest cannot be read: an embargoed dataset lists its manifests publicly but refuses anonymous
 * reads of them, and one unreadable title should leave the rest of the list alone.
 */
export async function fetchDandisetName(archive: PublicArchive, dandiset: ArchiveDandiset, signal?: AbortSignal): Promise<string | null> {
  try {
    const doc = (await fetchManifest(manifestUrl(archive, dandiset, DANDISET_MANIFEST), signal)) as { name?: unknown };
    return typeof doc.name === "string" && doc.name ? doc.name : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn(`Could not read the name of ${archive.label} dandiset ${dandiset.id}:`, e);
    return null;
  }
}

/** A video file in an archive, ready to be streamed. */
export interface ArchiveVideo {
  archiveId: ArchiveId;
  dandisetId: string;
  /** Path within the dataset, e.g. `sub-1/mice.mp4`. */
  path: string;
  /** Bytes, or null when the manifest does not say. */
  size: number | null;
  /** The bucket URL the frames are actually read from, byte range by byte range. */
  streamUrl: string;
  /** The archive's own citable URL for the asset, recorded as the clip's source. */
  assetUrl: string;
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
export function selectVideoAssets(archive: PublicArchive, dandisetId: string, manifest: unknown): ArchiveVideo[] {
  if (!Array.isArray(manifest)) return [];
  const videos: ArchiveVideo[] = [];
  for (const entry of manifest as unknown[]) {
    const raw = (entry ?? {}) as AssetManifestEntry;
    const path = typeof raw.path === "string" ? raw.path : "";
    if (!path || !isVideoAsset(path, raw.encodingFormat)) continue;
    const urls = (Array.isArray(raw.contentUrl) ? raw.contentUrl : []).filter((u): u is string => typeof u === "string");
    const streamUrl = urls.find((u) => isBucketUrl(u, archive.bucket));
    if (!streamUrl) continue;
    const size = typeof raw.contentSize === "number" ? raw.contentSize : null;
    videos.push({
      archiveId: archive.id,
      dandisetId,
      path,
      size,
      streamUrl,
      assetUrl: urls.find((u) => u !== streamUrl) ?? streamUrl,
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

/** Every video in one dataset. */
export async function fetchDandisetVideos(archive: PublicArchive, dandiset: ArchiveDandiset, signal?: AbortSignal): Promise<ArchiveVideo[]> {
  const manifest = await fetchManifest(manifestUrl(archive, dandiset, ASSETS_MANIFEST), signal);
  return selectVideoAssets(archive, dandiset.id, manifest);
}

/**
 * How much `assets.jsonld` a whole-archive sweep may read. EMBER's manifests come to a third of a
 * megabyte across every dataset it holds, so sweeping it up front and showing only the datasets
 * that actually contain video costs one short pause; DANDI's come to a gigabyte, so there the same
 * sweep is out of the question and datasets are opened one at a time instead. The listing reports
 * every manifest's size, so which archive is which is measured rather than assumed.
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
 * Reads every dataset's manifest and reports the videos it holds, calling `onDataset` as each one
 * lands so a caller can fill a list in as it goes. A dataset whose manifest cannot be read (an
 * embargoed one denies anonymous reads) reports no videos rather than failing the sweep.
 */
export async function sweepArchiveVideos(
  archive: PublicArchive,
  datasets: readonly ArchiveDandiset[],
  onDataset: (dandiset: ArchiveDandiset, videos: ArchiveVideo[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runQueue(datasets, SWEEP_CONCURRENCY, async (dandiset) => {
    let videos: ArchiveVideo[] = [];
    try {
      videos = await fetchDandisetVideos(archive, dandiset, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn(`Could not read the file list of ${archive.label} dandiset ${dandiset.id}:`, e);
    }
    onDataset(dandiset, videos);
  });
}

/** Fills in the names of the datasets it is handed, calling `onName` as each one arrives. */
export async function hydrateDandisetNames(
  archive: PublicArchive,
  datasets: readonly ArchiveDandiset[],
  onName: (dandiset: ArchiveDandiset, name: string | null) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runQueue(datasets, SWEEP_CONCURRENCY, async (dandiset) => {
    onName(dandiset, await fetchDandisetName(archive, dandiset, signal));
  });
}

/** The dataset's own page in the archive's web UI. */
export function dandisetWebUrl(archive: PublicArchive, dandiset: ArchiveDandiset): string {
  return `${archive.web}/dandiset/${dandiset.id}/${dandiset.version}`;
}
