import type { OAuthTokenSet } from "./types";
import { EMBER_INSTANCE, OAUTH_CLIENT_ID } from "./instances";

// Authorization Code + PKCE against the EMBER archive, mirroring brain-bbqs/bbqs-uploader's
// src/lib/oauth.ts — this app is equally backend-free, so the browser has to run the whole flow.
const VERIFIER_STORAGE_KEY = "clip-extractor.oauth-pkce.v1";

// Wherever this page is actually being served from (production deployment, a PR preview, local
// dev) — must be registered as a valid redirect URI on the archive side for that exact location.
function getRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

// django-oauth-toolkit's default access token lifetime; refreshed proactively before it's hit.
const REFRESH_SKEW_MS = 60_000;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

interface PendingLogin {
  verifier: string;
  state: string;
}

function savePendingLogin(pending: PendingLogin): void {
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, JSON.stringify(pending));
}

function takePendingLogin(): PendingLogin | null {
  const raw = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingLogin;
  } catch {
    return null;
  }
}

/** Redirects the browser to the archive's OAuth2 authorize page (Authorization Code + PKCE). */
export async function startLogin(navigate: (url: string) => void = (url) => window.location.assign(url)): Promise<void> {
  const verifier = randomString(32);
  const state = randomString(16);
  const challenge = await sha256Base64Url(verifier);
  savePendingLogin({ verifier, state });

  const url = new URL(`${EMBER_INSTANCE.oauth}/authorize/`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  navigate(url.toString());
}

function toTokenSet(resp: { access_token: string; refresh_token?: string; expires_in: number }): OAuthTokenSet {
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token,
    expiresAt: Date.now() + resp.expires_in * 1000,
  };
}

async function postTokenRequest(params: Record<string, string>): Promise<OAuthTokenSet> {
  const resp = await fetch(`${EMBER_INSTANCE.oauth}/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`OAuth token request failed (HTTP ${resp.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return toTokenSet((await resp.json()) as { access_token: string; refresh_token?: string; expires_in: number });
}

/**
 * If the current URL is an OAuth redirect callback (has `code` + `state` query params), completes
 * the PKCE exchange and returns the resulting tokens, stripping the OAuth params from the URL bar
 * either way. Returns null if this isn't a callback, or if `state` doesn't match what was sent.
 */
export async function handleRedirectCallback(): Promise<OAuthTokenSet | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return null;

  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("scope");
  window.history.replaceState({}, "", url.toString());

  const pending = takePendingLogin();
  if (!pending || pending.state !== state) return null;

  return postTokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: OAUTH_CLIENT_ID,
    code_verifier: pending.verifier,
  });
}

/** Returns a token set with a non-expired access token, refreshing it first if needed. */
export async function ensureFreshToken(tokens: OAuthTokenSet): Promise<OAuthTokenSet> {
  if (Date.now() < tokens.expiresAt - REFRESH_SKEW_MS) return tokens;
  if (!tokens.refreshToken) return tokens;
  return postTokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: OAUTH_CLIENT_ID,
  });
}

export async function revokeToken(tokens: OAuthTokenSet): Promise<void> {
  await fetch(`${EMBER_INSTANCE.oauth}/revoke_token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: tokens.accessToken,
      token_type_hint: "access_token",
      client_id: OAUTH_CLIENT_ID,
    }).toString(),
  }).catch(() => {
    /* best-effort: local state is cleared regardless */
  });
}
