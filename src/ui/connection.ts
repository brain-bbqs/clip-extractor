import type { ClipExtractorElements } from "./elements";
import type { ArchiveConfig } from "../lib/types";
import { apiFetch } from "../lib/api";
import { initialsFrom } from "../lib/format";

/**
 * Renders the header's "who's signed in" avatar/username as soon as there's an access token,
 * independent of whether an upload destination has been selected yet.
 */
export async function renderIdentity(els: ClipExtractorElements, cfg: ArchiveConfig): Promise<void> {
  if (!cfg.accessToken) return;
  try {
    const me = await apiFetch<{ username?: string; name?: string }>(cfg, "/users/me/");
    if (me?.username) {
      els.oauthUsername.textContent = me.username;
      els.oauthAvatar.textContent = initialsFrom(me.name ?? "");
    }
  } catch {
    /* leave the header as-is; the next refresh retries */
  }
}
