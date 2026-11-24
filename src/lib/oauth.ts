import { createOAuthClient } from "@brain-bbqs/ember-client";
import { EMBER_SANDBOX_INSTANCE } from "./sandbox";

// Clip Extractor's own public (PKCE, no client secret) OAuth2 application on the EMBER archive,
// deliberately separate from brain-bbqs/bbqs-uploader's, so the two tools can be revoked and
// audited independently. The redirect URI is computed at runtime from wherever this app is
// actually being served (the client's default) rather than hardcoded, since PR previews and local
// dev live at different paths than the production deployment: every location this app is served
// from has to be registered as a valid redirect URI on the archive side before sign-in works
// from there.
export const OAUTH_CLIENT_ID = "PjanEFNTu8cZDRvnS8aUbF5rZZyzJhwSeks9nc8X";

// Where a pending login's PKCE verifier and state wait in sessionStorage between the redirect out
// and the callback back. Renaming it would drop a sign-in that is mid-redirect across a deploy.
export const OAUTH_PKCE_STORAGE_KEY = "clip-extractor.oauth-pkce.v1";

export const oauth = createOAuthClient({ clientId: OAUTH_CLIENT_ID, storageKey: OAUTH_PKCE_STORAGE_KEY });

// The same application registered on EMBER's sandbox archive, for `?sandbox` (see lib/sandbox.ts).
// Its redirect URIs are registered there separately, so a served location signs in to the sandbox
// only once it has been added on that side too.
export const SANDBOX_OAUTH_CLIENT_ID = "h3l5j28tbqLma0eg2tvRLkhGonI3FVYOjQXjiDla";

// Its own key, so a sandbox sign-in mid-redirect and a production one never read each other's verifier.
export const SANDBOX_OAUTH_PKCE_STORAGE_KEY = "clip-extractor.sandbox.oauth-pkce.v1";

export const sandboxOAuth = createOAuthClient({
  clientId: SANDBOX_OAUTH_CLIENT_ID,
  storageKey: SANDBOX_OAUTH_PKCE_STORAGE_KEY,
  instance: EMBER_SANDBOX_INSTANCE,
});
