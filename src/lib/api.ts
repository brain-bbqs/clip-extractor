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
