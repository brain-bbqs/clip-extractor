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
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.accessToken}` };
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
      `Network error calling ${path}. Check your connection (or the server's CORS policy): ${
        e instanceof Error ? e.message : String(e)
      }`,
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
