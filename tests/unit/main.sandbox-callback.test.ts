// @vitest-environment jsdom
// Boots the real app as the load a sandbox sign-in returns to: the archive sends it back to the bare
// page address with only `?code=&state=`, yet the code is exchanged with the sandbox archive, the
// tokens are stored as the sandbox's, and `?sandbox` is put back in the address for the loads after.
import { jsonResponse, routeFetch } from "@brain-bbqs/test-utils/vitest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SANDBOX_OAUTH_CLIENT_ID, SANDBOX_OAUTH_PKCE_STORAGE_KEY } from "../../src/lib/oauth";
import { SANDBOX_LOGIN_KEY } from "../../src/lib/sandbox";
import { SANDBOX_STORAGE_KEY, STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const SANDBOX = "https://api-dandi.sandbox.emberarchive.org";

const archive = routeFetch([
  {
    match: `${SANDBOX}/oauth/token/`,
    respond: () => jsonResponse({ access_token: "fresh-sandbox-token", refresh_token: "rt", expires_in: 3600 }),
  },
  { match: `${SANDBOX}/api/users/me/`, respond: () => jsonResponse({ username: "ada", name: "Ada Lovelace" }) },
  { match: `${SANDBOX}/api/dandisets/?user=me`, respond: () => jsonResponse({ count: 0, next: null, previous: null, results: [] }) },
]);

beforeAll(async () => {
  await bootMain({
    url: "?code=the-code&state=the-state",
    fetch: archive,
    sessionStorage: {
      [SANDBOX_LOGIN_KEY]: "the-state",
      [SANDBOX_OAUTH_PKCE_STORAGE_KEY]: JSON.stringify({ verifier: "the-verifier", state: "the-state" }),
    },
  });
  await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("ada"));
});

describe("main.ts boot on a sandbox sign-in's callback", () => {
  it("exchanges the code with the sandbox archive under the sandbox client id", () => {
    const [token] = archive.callsTo(`${SANDBOX}/oauth/token/`);
    expect(Object.fromEntries(new URLSearchParams(String(token.init?.body)))).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: `${location.origin}/`,
      client_id: SANDBOX_OAUTH_CLIENT_ID,
      code_verifier: "the-verifier",
    });
    expect(archive.callsTo("api-dandi.emberarchive.org")).toEqual([]);
  });

  it("stores the tokens as the sandbox's, not production's", () => {
    expect(JSON.parse(localStorage.getItem(SANDBOX_STORAGE_KEY) ?? "null")?.oauth?.accessToken).toBe("fresh-sandbox-token");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")?.oauth).toBe(undefined);
  });

  it("puts ?sandbox back in the address in place of the callback's params", () => {
    const params = new URLSearchParams(location.search);
    expect([...params.keys()]).toEqual(["sandbox"]);
    expect(sessionStorage.getItem(SANDBOX_LOGIN_KEY)).toBe(null);
  });
});
