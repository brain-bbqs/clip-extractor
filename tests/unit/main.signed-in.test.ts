// @vitest-environment jsdom
// Boots the real app as a returning visitor with a stored EMBER sign-in, against a stubbed archive:
// the header names the account and the upload destination lists the one incoming dataset.
import { jsonResponse, routeFetch } from "@brain-bbqs/test-utils/vitest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const API = "https://api-dandi.emberarchive.org/api";

const archive = routeFetch([
  { match: `${API}/users/me/`, respond: () => jsonResponse({ username: "ada", name: "Ada Lovelace" }) },
  {
    match: `${API}/dandisets/?user=me&embargoed=true&page_size=1000`,
    respond: () =>
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ identifier: "000123", draft_version: { name: "Incoming: Test Lab" }, embargo_status: "EMBARGOED" }],
      }),
  },
  { match: "/admin-owned/000123", respond: () => jsonResponse({ adminOwned: true }) },
  {
    match: `${API}/dandisets/000123/versions/draft/`,
    respond: () => jsonResponse({ name: "Incoming: Test Lab", description: "A test dataset." }),
  },
]);

const stored = JSON.stringify({ oauth: { accessToken: "stored-token", expiresAt: Date.now() + 3_600_000 } });

beforeAll(async () => {
  await bootMain({ fetch: archive, localStorage: { [STORAGE_KEY]: stored } });
  await vi.waitFor(() => expect(el("dandisetSingle").hidden).toBe(false));
});

describe("main.ts boot, signed in", () => {
  it("swaps the sign-in button for the account menu, naming the account", async () => {
    expect(el("oauthSigninBtn").hidden).toBe(true);
    expect(el("oauthSignedIn").hidden).toBe(false);
    await vi.waitFor(() => expect(el("oauthUsername").textContent).toBe("ada"));
    expect(el("oauthAvatar").textContent).toBe("AL");
  });

  it("names the one incoming dataset as the upload destination, with a link to it", () => {
    expect(el("dandisetSingleText").textContent).toBe('Uploading directly to EMBER Dandiset 000123, "Incoming: Test Lab"');
    expect(el("dandisetMessage").hidden).toBe(true);
    expect(el("viewDatasetLink").hidden).toBe(false);
    expect(el("viewDatasetLink").getAttribute("href")).toBe("https://dandi.emberarchive.org/dandiset/000123/draft");
    expect(el("deliverToggleRow").hidden).toBe(false);
  });

  it("sends the stored token to the archive and nothing to the admin check", async () => {
    await vi.waitFor(() => expect(archive.callsTo("/versions/draft/").length).toBe(1));
    const archiveCalls = archive.callsTo(API);
    expect(archiveCalls.map((c) => c.url.slice(API.length)).sort()).toEqual([
      "/dandisets/000123/versions/draft/",
      "/dandisets/?user=me&embargoed=true&page_size=1000",
      "/users/me/",
    ]);
    for (const call of archiveCalls) expect(new Headers(call.init?.headers).get("Authorization")).toBe("Bearer stored-token");
    const [adminCheck] = archive.callsTo("/admin-owned/000123");
    expect(new Headers(adminCheck.init?.headers).get("Authorization")).toBe(null);
  });

  it("keeps the stored sign-in", () => {
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")?.oauth?.accessToken).toBe("stored-token");
  });
});
