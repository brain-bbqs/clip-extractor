import type { DandiInstance } from "./types";

export const EMBER_INSTANCE: DandiInstance = {
  api: "https://api-dandi.emberarchive.org/api",
  web: "https://dandi.emberarchive.org",
  oauth: "https://api-dandi.emberarchive.org/oauth",
};

// Clip Extractor's own public (PKCE, no client secret) OAuth2 application on the EMBER archive —
// deliberately separate from brain-bbqs/bbqs-uploader's, so the two tools can be revoked and
// audited independently. The redirect URI is computed at runtime from wherever this app is
// actually being served (see oauth.ts) rather than hardcoded, since PR previews and local dev
// live at different paths than the production deployment — every location this app is served
// from has to be registered as a valid redirect URI on the archive side before sign-in works
// from there.
export const OAUTH_CLIENT_ID = "PjanEFNTu8cZDRvnS8aUbF5rZZyzJhwSeks9nc8X";
