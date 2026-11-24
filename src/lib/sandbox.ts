import type { DandiInstance } from "@brain-bbqs/ember-client";

// `?sandbox`: a testing-only switch that points sign-in and every EMBER API call at the archive's
// sandbox instance rather than production, so signing in, listing owned datasets and uploading can
// be exercised end to end without a real account's data on the other end.
//
// The sandbox is a separate archive with its own accounts, so it gets its own OAuth application
// (lib/oauth.ts) and its own stored settings (lib/settings.ts): a production sign-in is never sent
// to the sandbox, a sandbox one never to production, and switching between the two leaves the other
// side's session as it was. Opening `?sandbox` for the first time therefore starts signed out.
//
// Only the archive's API and sign-in move. The browse pane's public listing is read from
// production's open-data bucket either way (see lib/archives.ts's EMBER_ARCHIVE), since that bucket
// is the only one this app knows how to list.

/** The query param that turns sandbox mode on. Present at all, with any value or none, is on. */
export const SANDBOX_PARAM = "sandbox";

/** EMBER's sandbox archive, laid out the same way as `EMBER_INSTANCE` from `@brain-bbqs/ember-client`. */
export const EMBER_SANDBOX_INSTANCE: DandiInstance = {
  api: "https://api-dandi.sandbox.emberarchive.org/api",
  web: "https://dandi.sandbox.emberarchive.org",
  oauth: "https://api-dandi.sandbox.emberarchive.org/oauth",
};

/**
 * Where a sandbox sign-in's OAuth `state` waits in sessionStorage for the load that comes back.
 *
 * The archive can only return to the bare page address (see lib/oauth.ts's redirect URI), so the
 * load a sandbox sign-in lands on carries `?code=&state=` and no `?sandbox`. That load still has to
 * finish the sign-in against the sandbox, so the `state` sent out is kept here and matched against
 * the one that comes back: a match is a sandbox sign-in landing, anything else is not.
 */
export const SANDBOX_LOGIN_KEY = "clip-extractor.sandbox-login.v1";

/**
 * Whether this load talks to the sandbox: the param is in the address, or this is the load a
 * sandbox sign-in is returning to (its `state` is the one {@link rememberSandboxLogin} kept).
 */
export function readSandbox(search: string, pendingSandboxState: string | null): boolean {
  const params = new URLSearchParams(search);
  if (params.has(SANDBOX_PARAM)) return true;
  const state = params.get("state");
  return Boolean(params.get("code") && state && state === pendingSandboxState);
}

/** `search` with the sandbox param added, unchanged when it is already there. Written as a bare
 * flag, the way it is typed, rather than the `sandbox=` URLSearchParams would spell it. */
export function withSandboxParam(search: string): string {
  if (new URLSearchParams(search).has(SANDBOX_PARAM)) return search;
  const rest = search.replace(/^\?/, "");
  return rest ? `?${SANDBOX_PARAM}&${rest}` : `?${SANDBOX_PARAM}`;
}

/** Keeps the `state` of the sandbox sign-in about to leave for `authorizeUrl`, for
 * {@link readSandbox} on the load that comes back. */
export function rememberSandboxLogin(authorizeUrl: string): void {
  const state = new URL(authorizeUrl).searchParams.get("state");
  try {
    if (state) sessionStorage.setItem(SANDBOX_LOGIN_KEY, state);
  } catch (e) {
    console.warn("Could not hold the sandbox sign-in across the redirect:", e);
  }
}

/** Reads back what {@link rememberSandboxLogin} kept, clearing it: it is only ever good for the
 * next load. */
export function takeSandboxLogin(): string | null {
  try {
    const held = sessionStorage.getItem(SANDBOX_LOGIN_KEY);
    sessionStorage.removeItem(SANDBOX_LOGIN_KEY);
    return held;
  } catch {
    return null;
  }
}
