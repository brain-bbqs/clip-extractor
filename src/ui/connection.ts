import type { ClipExtractorElements } from "./elements";
import type { ArchiveConfig } from "../lib/types";
import { fetchArchiveUser, type ArchiveUser } from "../lib/users";
import { initialsFrom } from "../lib/format";

/**
 * Renders the header's "who's signed in" avatar/username as soon as there's an access token,
 * independent of whether an upload destination has been selected yet. Returns the account it
 * rendered, so the caller can reuse it (the provenance record names the uploader) instead of
 * asking the archive a second time.
 */
export async function renderIdentity(els: ClipExtractorElements, cfg: ArchiveConfig): Promise<ArchiveUser | null> {
  try {
    const user = await fetchArchiveUser(cfg);
    if (user) {
      els.oauthUsername.textContent = user.username;
      els.oauthAvatar.textContent = initialsFrom(user.name ?? "");
    }
    return user;
  } catch {
    /* leave the header as-is; the next refresh retries */
    return null;
  }
}
