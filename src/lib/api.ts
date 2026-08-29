import type { ArchiveConfig } from "./types";
import { ApiError } from "./errors";

export interface ApiFetchOptions {
  method?: string;
  json?: unknown;
}

/** Bearer-authenticated JSON call against the archive's REST API. Mirrors bbqs-uploader's. */
export async function apiFetch<T = unknown>(
  cfg: ArchiveConfig,
  path: string,
  { method = "GET", json }: ApiFetchOptions = {},
): Promise<T | null> {
  // Omitted rather than sent empty: an anonymous call (no `accessToken`) has to reach the archive's
  // public endpoints as a real anonymous request. `Authorization: Bearer ` with nothing after it is
  // still a credential as far as the archive's auth middleware is concerned — it rejects the empty
  // token outright instead of falling back to anonymous access, which would 401 every signed-out
  // caller of apiFetch, including the public dandiset listing in lib/archives.ts.
  const headers: Record<string, string> = cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {};
  let body: string | undefined;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  let resp: Response;
  try {
    resp = await fetch(`${cfg.api}${path}`, { method, headers, body });
  } catch (e) {
    throw new ApiError(
      `Network error calling ${path}. Check your connection (or the server's CORS policy): ${e instanceof Error ? e.message : String(e)}`,
      0,
    );
  }
  if (!resp.ok) {
    let detail = "";
    try {
      detail = await resp.text();
    } catch {
      /* ignore */
    }
    throw new ApiError(`${method} ${path} failed with HTTP ${resp.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`, resp.status);
  }
  if (resp.status === 204) return null;
  return (await resp.json()) as T;
}

/** The slice of the archive's dandiset-listing response both lib/dandisets.ts (upload destinations)
 * and lib/embargoed.ts (what a signed-in visitor may browse) read. They ask for different sets and
 * do different things with the answer, but the archive describes a dandiset the same way to both. */
export interface DandisetListItem {
  identifier: string;
  embargo_status?: string;
  draft_version?: { name?: string };
  most_recent_published_version?: { name?: string };
}

export interface DandisetListResponse {
  results?: DandisetListItem[];
  next?: string | null;
}

/** A listed dandiset's title: the published name where there is one, else the draft's, else nothing.
 * Every dandiset has a draft; only some have been published, and a published name is the more
 * considered of the two. */
export function listedTitle(item: DandisetListItem): string {
  return item.most_recent_published_version?.name ?? item.draft_version?.name ?? "";
}

/** The path to ask {@link apiFetch} for next, from the absolute `next` URL a paged response carries.
 * Null both when there is no next page and when it points somewhere other than this archive, which
 * is not ours to follow. */
export function nextPagePath(cfg: ArchiveConfig, next: string | null | undefined): string | null {
  return next && next.startsWith(cfg.api) ? next.slice(cfg.api.length) : null;
}
