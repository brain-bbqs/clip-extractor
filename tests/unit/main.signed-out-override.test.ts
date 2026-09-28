// @vitest-environment jsdom
// Boots the real app under `?test&signed_out` with a real sign-in stored: every auth-dependent
// surface renders signed out, nothing is asked of the archive, and the stored token is left alone,
// since the injection overrides the render rather than signing out.
import { beforeAll, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const stored = JSON.stringify({ oauth: { accessToken: "stored-token", expiresAt: Date.now() + 3_600_000 } });

let booted: Awaited<ReturnType<typeof bootMain>>;

beforeAll(async () => {
  booted = await bootMain({ url: "?test&signed_out", localStorage: { [STORAGE_KEY]: stored } });
});

describe("main.ts boot with ?test&signed_out over a stored sign-in", () => {
  it("shows the sign-in button and no upload destination", () => {
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(el("oauthSignedIn").hidden).toBe(true);
    expect(el("deliverToggleRow").hidden).toBe(true);
    expect(el("dandisetMessage").textContent).toBe("Please sign in to see your incoming datasets.");
  });

  it("asks nothing of the archive and keeps the stored token", () => {
    expect(booted.fetch?.calls).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
  });
});
