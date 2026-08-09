import type { ArchiveConfig, StoredSettings } from "./types";
import { EMBER_INSTANCE } from "./instances";

// Also read by the inline pre-paint script in index.html — keep the two literals in sync.
export const STORAGE_KEY = "clip-extractor.settings.v1";

export function loadStoredSettings(): StoredSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSettings;
  } catch (e) {
    console.warn("Could not restore settings:", e);
    return null;
  }
}

export function saveStoredSettings(settings: StoredSettings | null): void {
  try {
    if (!settings) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    // clip-extractor is a fully static, backend-free page (no server to hold a session), so
    // client storage is the only place to persist the OAuth token between page loads. Accepted
    // and documented trade-off, following the "clear text storage" playbook in bbqs-uploader's
    // SECURITY.md: there is no HTML-injection sink in this app to exploit it through (the only
    // innerHTML writes are two static glyph literals, and every archive-supplied string is
    // rendered via textContent), sessionStorage is flagged the same way, and client-side
    // "encryption" of a client-held secret is theater — any key this app's JS can reach,
    // injected JS can reach too.
    // codeql[js/clear-text-storage-of-sensitive-data]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("Could not save settings:", e);
  }
}

/** Resolves the archive config the API helpers take from the current sign-in + dataset choice. */
export function resolveConfig(input: { dandisetId: string; oauthAccessToken?: string; embargoed?: boolean }): ArchiveConfig {
  const rawId = input.dandisetId.trim();
  const idMatch = /(^|[^-\d])(\d{6,})/.exec(rawId);
  return {
    api: EMBER_INSTANCE.api,
    web: EMBER_INSTANCE.web,
    accessToken: input.oauthAccessToken ?? "",
    dandisetId: idMatch ? idMatch[2] : "",
    embargoed: input.embargoed,
  };
}
