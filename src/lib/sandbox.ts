import {
  apiFetch,
  INCOMING_PREFIX,
  listedTitle,
  type ArchiveConfig,
  type DandiInstance,
  type DandisetListResponse,
  type IncomingDandisetsResult,
} from "@brain-bbqs/ember-client";

// `?sandbox`: a testing-only switch that points sign-in and every EMBER API call at the archive's
// sandbox instance rather than production, so signing in, listing owned datasets and uploading can
// be exercised end to end without a real account's data on the other end.
//
// The sandbox is a separate archive with its own accounts, so it gets its own OAuth application
// (lib/oauth.ts) and its own stored settings (lib/settings.ts): a production sign-in is never sent
// to the sandbox, a sandbox one never to production, and switching between the two leaves the other
// side's session as it was. Opening `?sandbox` for the first time therefore starts signed out.
//
// Nothing reads production while it is on. The browse pane lists the sandbox's datasets, public ones
// included, through the sandbox's API rather than production's open-data bucket (see the pane's
// `apiOnly`), and the upload destination list skips the BBQS/EMBER admin-check service, which
// answers for production's datasets (see listSandboxIncomingDandisets).

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

/**
 * The upload destinations under `?sandbox`: every "Incoming: " dataset the account owns on the
 * sandbox, without `listIncomingDandisets`' admin-owner check.
 *
 * That check asks a BBQS/EMBER companion service whether an admin co-owns each candidate, and the
 * service reads production's owner lists, so it would judge a sandbox dataset by whatever production
 * dataset happens to share its identifier. It only ever curated what the picker offers (the archive's
 * own ownership permissions are what authorize an upload; see SECURITY.md), and a sandbox upload
 * lands on test data, so it is dropped here rather than answered wrongly. Same call, filter and
 * order as the checked list otherwise.
 */
export async function listSandboxIncomingDandisets(cfg: ArchiveConfig): Promise<IncomingDandisetsResult> {
  const resp = await apiFetch<DandisetListResponse>(cfg, "/dandisets/?user=me&embargoed=true&page_size=1000");
  const datasets = (resp?.results ?? [])
    .map((d) => ({ identifier: d.identifier, title: listedTitle(d), embargoed: d.embargo_status === "EMBARGOED" }))
    .filter((d) => d.title.startsWith(INCOMING_PREFIX))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { datasets, unverified: 0 };
}
