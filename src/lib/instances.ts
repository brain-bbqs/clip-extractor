import type { DandiInstance } from "./types";

export const EMBER_INSTANCE: DandiInstance = {
  api: "https://api-dandi.emberarchive.org/api",
  web: "https://dandi.emberarchive.org",
  oauth: "https://api-dandi.emberarchive.org/oauth",
};

// The same public (PKCE, no client secret) OAuth2 application brain-bbqs/bbqs-uploader signs in
// against. The redirect URI is computed at runtime from wherever this app is actually being
// served (see oauth.ts) rather than hardcoded, since PR previews and local dev live at different
// paths than the production deployment — every location this app is served from still has to be
// added as a valid redirect URI on the archive side (or covered by a wildcard) before sign-in
// works from there.
export const OAUTH_CLIENT_ID = "KoQNdyPaJULkfRJXa9YSm6PTC29TLzEz8yZH3vNv";
