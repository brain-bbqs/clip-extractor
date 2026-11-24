// @vitest-environment jsdom
// Boots the real app under `?sandbox` as a returning visitor signed in to both archives: every call
// goes to the sandbox archive under the sandbox token, the production one stays where it was, and
// the upload destination is offered without the admin check.
import { jsonResponse, routeFetch } from "@brain-bbqs/test-utils/vitest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SANDBOX_STORAGE_KEY, STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const SANDBOX_API = "https://api-dandi.sandbox.emberarchive.org/api";

const archive = routeFetch([
  { match: `${SANDBOX_API}/users/me/`, respond: () => jsonResponse({ username: "ada", name: "Ada Lovelace" }) },
  {
    match: `${SANDBOX_API}/dandisets/?user=me&embargoed=true&page_size=1000`,
    respond: () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ identifier: "000123", draft_version: { name: "Incoming: Sandbox Lab" }, embargo_status: "EMBARGOED" }],
      }),
  },
  {
    match: `${SANDBOX_API}/dandisets/000123/versions/draft/`,
    respond: () => jsonResponse({ name: "Incoming: Sandbox Lab", description: "A sandbox dataset." }),
  },
]);

const production = JSON.stringify({ dandisetId: "000999", oauth: { accessToken: "production-token", expiresAt: Date.now() + 3_600_000 } });
const sandbox = JSON.stringify({ oauth: { accessToken: "sandbox-token", expiresAt: Date.now() + 3_600_000 } });

beforeAll(async () => {
  await bootMain({ url: "?sandbox", fetch: archive, localStorage: { [STORAGE_KEY]: production, [SANDBOX_STORAGE_KEY]: sandbox } });
  await vi.waitFor(() => expect(el("dandisetSingle").hidden).toBe(false));
});

describe("main.ts boot under ?sandbox, signed in to the sandbox", () => {
  it("names the sandbox dataset as the upload destination, linking to the sandbox's web UI", async () => {
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("ada"));
    expect(el("dandisetSingleText").textContent).toBe('Uploading directly to EMBER Dandiset 000123, "Incoming: Sandbox Lab"');
    expect(el("viewDatasetLink").getAttribute("href")).toBe("https://dandi.sandbox.emberarchive.org/dandiset/000123/draft");
  });

  it("sends the sandbox token to the sandbox archive and nothing to production", async () => {
    await vi.waitFor(() => expect(archive.callsTo("/versions/draft/").length).toBe(1));
    const sandboxCalls = archive.callsTo(SANDBOX_API);
    expect(sandboxCalls.map((c) => c.url.slice(SANDBOX_API.length)).sort()).toEqual([
      "/dandisets/000123/versions/draft/",
      "/dandisets/?user=me&embargoed=true&page_size=1000",
      "/users/me/",
    ]);
    for (const call of sandboxCalls) expect(new Headers(call.init?.headers).get("Authorization")).toBe("Bearer sandbox-token");
    expect(archive.callsTo("api-dandi.emberarchive.org")).toEqual([]);
  });

  it("offers the dataset without asking the admin check, which answers for production", () => {
    expect(archive.callsTo("/admin-owned/")).toEqual([]);
  });

  it("keeps each archive's sign-in under its own key", () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBe(production);
    const saved = JSON.parse(localStorage.getItem(SANDBOX_STORAGE_KEY) ?? "null") as {
      dandisetId?: string;
      oauth?: { accessToken?: string };
    };
    expect(saved.oauth?.accessToken).toBe("sandbox-token");
    expect(saved.dandisetId).toBe("000123");
  });
});
