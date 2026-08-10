import type { ArchiveConfig } from "./types";
import { apiFetch } from "./api";

/** Who the current access token belongs to, as the archive reports it. */
export interface ArchiveUser {
  username: string;
  name: string | null;
}

interface UserResponse {
  username?: string;
  name?: string;
}

/** Looks up the signed-in account. Returns null when there is no token or the archive does not
 * name a user — callers treat the identity as unknown rather than failing. */
export async function fetchArchiveUser(cfg: ArchiveConfig): Promise<ArchiveUser | null> {
  if (!cfg.accessToken) return null;
  const me = await apiFetch<UserResponse>(cfg, "/users/me/");
  if (!me?.username) return null;
  return { username: me.username, name: me.name ?? null };
}
