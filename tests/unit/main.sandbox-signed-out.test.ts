// @vitest-environment jsdom
// Boots the real app under `?sandbox` with only a production sign-in stored: the sandbox starts
// signed out, the production token is neither sent anywhere nor touched, and nothing is asked of the
// production archive's API.
import { beforeAll, describe, expect, it } from "vitest";
import { SANDBOX_STORAGE_KEY, STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const stored = JSON.stringify({ oauth: { accessToken: "production-token", expiresAt: Date.now() + 3_600_000 } });

let booted: Awaited<ReturnType<typeof bootMain>>;

beforeAll(async () => {
  booted = await bootMain({ url: "?sandbox", localStorage: { [STORAGE_KEY]: stored } });
});

describe("main.ts boot with ?sandbox over a production sign-in", () => {
  it("shows the sign-in button and no upload destination", () => {
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el("deliverToggleRow").hidden).toBe(true);
    expect(el("dandisetMessage").textContent).toBe("Please sign in to see your incoming datasets.");
  });

  it("sends the production token nowhere and leaves it stored", () => {
    for (const call of booted.fetch?.calls ?? []) {
      expect(call.url.startsWith("https://api-dandi.emberarchive.org/api/users/")).toBe(false);
      expect(new Headers(call.init?.headers).get("Authorization")).toBe(null);
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(JSON.parse(localStorage.getItem(SANDBOX_STORAGE_KEY) ?? "null")?.oauth).toBe(undefined);
  });

  it("keeps the flag in the address", () => {
    expect(location.search).toBe("?sandbox");
  });
});
