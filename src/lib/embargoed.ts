import type { ArchiveConfig } from "./types";
import type { ArchiveDandiset, ArchiveVideo } from "./archives";
import { isVideoAsset } from "./archives";
import { apiFetch } from "./api";

// The half of the browse pane that the public S3 bucket cannot answer.
//
// An embargoed dataset's manifests are listed in the public bucket but refuse anonymous reads —
// that is what the embargo is — so nothing about it can be read the way lib/archives.ts reads a
// public dataset. What a signed-in visitor owns is asked of the archive's API instead, against the
// same OAuth token the upload side already holds: which datasets they own, what is in one, and a
// signed URL for the bytes of a chosen video.

interface DandisetListItem {
  identifier: string;
  embargo_status?: string;
  draft_version?: { name?: string };
  most_recent_published_version?: { name?: string };
}

interface DandisetListResponse {
  results?: DandisetListItem[];
  next?: string | null;
}

interface DandisetOwner {
  username?: string;
}

/** Pages read while listing every public dandiset before the walk gives up, at the page size below. */
const MAX_PUBLIC_LIST_PAGES = 50;
const PUBLIC_LIST_PAGE_SIZE = 1000;

/**
 * Every dandiset identifier the archive will hand an anonymous caller — the authoritative set of
 * what is actually public. lib/archives.ts finds *candidate* datasets by listing the public S3
 * bucket, but a dataset embargoed against everyone but its owner is listed there too, indistinguishable
 * from a public one, because reading its manifest does not reliably fail the way an embargo is meant
 * to enforce. The archive's own API is the one place that actually enforces the embargo: called with
 * no token, exactly as a signed-out visitor would be, it only ever returns what is genuinely public,
 * so a bucket candidate is trusted only once its identifier turns up here too.
 */
export async function listPublicDandisetIds(cfg: ArchiveConfig, signal?: AbortSignal): Promise<Set<string>> {
  const anonymous: ArchiveConfig = { ...cfg, accessToken: "" };
  const ids = new Set<string>();
  let path: string | null = `/dandisets/?page_size=${PUBLIC_LIST_PAGE_SIZE}`;
  for (let page = 0; path && page < MAX_PUBLIC_LIST_PAGES; page++) {
    if (signal?.aborted) throw new Error("Listing cancelled.");
    const body: DandisetListResponse = (await apiFetch<DandisetListResponse>(anonymous, path)) ?? {};
    for (const d of body.results ?? []) ids.add(d.identifier);
    path = body.next && body.next.startsWith(cfg.api) ? body.next.slice(cfg.api.length) : null;
  }
  return ids;
}

/**
 * Whether `username` appears in the dandiset's own owner list.
 *
 * `?user=me` is not enough to answer this. The archive resolves it through object permissions, and
 * a superuser holds those globally — so an EMBER or BBQS admin gets back every embargoed dataset in
 * the archive, not the ones they are actually listed against. The owner list is the archive's own
 * record of who a dataset belongs to, so that is what is read.
 */
async function isListedOwner(cfg: ArchiveConfig, identifier: string, username: string): Promise<boolean> {
  const owners = await apiFetch<DandisetOwner[]>(cfg, `/dandisets/${identifier}/users/`);
  return (owners ?? []).some((owner) => owner.username === username);
}

/**
 * The embargoed datasets `username` is listed as an owner of.
 *
 * `page_size=1000` is the archive's maximum and comfortably covers any one person's datasets, so
 * further pages are never followed — the same call as the upload destination list in
 * lib/dandisets.ts, minus that list's "Incoming: " and admin-owner gates. Those gate where an
 * upload may *go*; this only asks what its owner may already read.
 *
 * Fails closed throughout: with no username to check against, and for any dataset whose owner list
 * cannot be read, nothing is offered. Someone else's embargoed data is not a thing to show on a
 * guess.
 */
export async function listOwnedEmbargoedDandisets(cfg: ArchiveConfig, username: string): Promise<ArchiveDandiset[]> {
  if (!username) return [];
  const resp = await apiFetch<DandisetListResponse>(cfg, "/dandisets/?user=me&embargoed=true&page_size=1000");
  const candidates = (resp?.results ?? [])
    .filter((d) => d.embargo_status === "EMBARGOED")
    .map((d) => ({
      id: d.identifier,
      // An embargoed dataset has nothing published, so the draft is the only version there is.
      version: "draft",
      // No manifest is read for it, so there is no manifest size to report.
      manifestBytes: 0,
      embargoed: true,
      name: d.most_recent_published_version?.name ?? d.draft_version?.name ?? "",
    }));

  const owned = await Promise.all(
    candidates.map((d) =>
      isListedOwner(cfg, d.id, username).catch((e: unknown) => {
        console.warn(`Could not read the owners of dandiset ${d.id}:`, e);
        return false;
      }),
    ),
  );
  return candidates.filter((_, i) => owned[i]).sort((a, b) => a.id.localeCompare(b.id));
}

interface AssetListItem {
  asset_id?: string;
  path?: string;
  size?: number;
}

interface AssetListResponse {
  results?: AssetListItem[];
  next?: string | null;
}

/** Asset pages read for one dataset before the walk gives up, at the page size below. */
const MAX_ASSET_PAGES = 20;
const ASSET_PAGE_SIZE = 1000;

/**
 * Every video in one embargoed dataset's draft, from the API's asset listing.
 *
 * `metadata=false` keeps the response to the identifier, path and size of each asset, which is all
 * a list of videos needs; asking for each asset's full metadata would multiply the payload for
 * nothing. The listing has no `encodingFormat` either way, so what counts as video here is decided
 * by the file's own extension.
 */
export async function listEmbargoedVideos(cfg: ArchiveConfig, dandisetId: string, signal?: AbortSignal): Promise<ArchiveVideo[]> {
  const videos: ArchiveVideo[] = [];
  let path: string | null = `/dandisets/${dandisetId}/versions/draft/assets/?metadata=false&page_size=${ASSET_PAGE_SIZE}`;
  for (let page = 0; path && page < MAX_ASSET_PAGES; page++) {
    if (signal?.aborted) throw new Error("Listing cancelled.");
    const body: AssetListResponse = (await apiFetch<AssetListResponse>(cfg, path)) ?? {};
    for (const asset of body.results ?? []) {
      if (!asset.asset_id || !asset.path || !isVideoAsset(asset.path)) continue;
      videos.push({
        dandisetId,
        path: asset.path,
        size: typeof asset.size === "number" ? asset.size : null,
        // The download endpoint, which is both the citable URL for the asset and the thing that
        // hands out a signed URL for its bytes (see resolveEmbargoedStreamUrl).
        assetUrl: `${cfg.api}/assets/${asset.asset_id}/download/`,
        streamUrl: null,
        embargoed: true,
      });
    }
    // The archive returns absolute `next` URLs; apiFetch takes paths, and a next page pointing at
    // another host is not this archive's to follow.
    path = body.next && body.next.startsWith(cfg.api) ? body.next.slice(cfg.api.length) : null;
  }
  return videos.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Whether `url` is this archive's own download endpoint for an asset.
 *
 * That is the address a video picked out of the browse pane is recorded against, and so the one a
 * shared link carries: it names the asset rather than its content hash, and for an embargoed file
 * it is the only one still resolving tomorrow. The bytes are somewhere else — see below — so an
 * address of this shape has to be exchanged for a bucket URL before a player can read it.
 */
export function isAssetDownloadUrl(cfg: ArchiveConfig, url: string): boolean {
  return url.startsWith(`${cfg.api}/assets/`) && /\/assets\/[^/]+\/download\/?$/.test(url);
}

/**
 * Turns an embargoed asset's download URL into the signed bucket URL its bytes are actually at.
 *
 * The archive answers the download endpoint with a redirect to a short-lived signed URL. The
 * browser follows that redirect itself — dropping the `Authorization` header on the way, as it
 * must, since the signature in the URL is the bucket's only accepted credential — and reports
 * where it landed as `response.url`. Only the first byte is asked for, because the point of the
 * request is the address it ends at rather than anything in the body; the player opens the file
 * again from there.
 */
export async function resolveEmbargoedStreamUrl(cfg: ArchiveConfig, assetUrl: string, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(assetUrl, {
    headers: { Authorization: `Bearer ${cfg.accessToken}`, Range: "bytes=0-0" },
    signal,
  });
  // Nothing reads the body; releasing it keeps the connection from being held open for a byte.
  void resp.body?.cancel().catch(() => {});
  if (!resp.ok) throw new Error(`The archive refused to hand out this embargoed file (HTTP ${resp.status}).`);
  if (!resp.url || resp.url === assetUrl) {
    throw new Error("The archive did not redirect this embargoed file to a signed URL, so it cannot be streamed.");
  }
  return resp.url;
}
