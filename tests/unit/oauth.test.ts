import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { ensureFreshToken, handleRedirectCallback, revokeToken, startLogin } from "../../src/lib/oauth";
import { EMBER_INSTANCE, OAUTH_CLIENT_ID } from "../../src/lib/instances";

// jsdom's Crypto has getRandomValues but no SubtleCrypto, which the PKCE challenge needs.
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function tokenResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve("") } as unknown as Response;
}

describe("startLogin", () => {
  it("redirects to the archive's authorize page with an S256 PKCE challenge", async () => {
    let navigated = "";
    await startLogin((url) => (navigated = url));
    const url = new URL(navigated);
    expect(url.origin + url.pathname).toBe(`${EMBER_INSTANCE.oauth}/authorize/`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(OAUTH_CLIENT_ID);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(`${window.location.origin}/`);
  });

  it("stashes the verifier and state for the callback to pick up", async () => {
    let navigated = "";
    await startLogin((url) => (navigated = url));
    const pending = JSON.parse(sessionStorage.getItem("clip-extractor.oauth-pkce.v1") ?? "null") as {
      verifier: string;
      state: string;
    } | null;
    expect(pending?.verifier).toBeTruthy();
    expect(pending?.state).toBe(new URL(navigated).searchParams.get("state"));
  });
});

describe("handleRedirectCallback", () => {
  it("returns null when the URL isn't a callback", async () => {
    expect(await handleRedirectCallback()).toBe(null);
  });

  it("exchanges the code for tokens and strips the OAuth params from the URL", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(tokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetchMock);
    await startLogin(() => {});
    const state = (JSON.parse(sessionStorage.getItem("clip-extractor.oauth-pkce.v1") ?? "{}") as { state: string }).state;
    window.history.replaceState({}, "", `/?keep=1&code=the-code&state=${state}&scope=read`);

    const tokens = await handleRedirectCallback();
    expect(tokens?.accessToken).toBe("at");
    expect(tokens?.refreshToken).toBe("rt");
    expect(tokens?.expiresAt).toBeGreaterThan(Date.now());
    // Only the OAuth params are stripped; anything else the page was opened with survives.
    expect(window.location.search).toBe("?keep=1");
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(new URLSearchParams(body).get("grant_type")).toBe("authorization_code");
    expect(new URLSearchParams(body).get("code_verifier")).toBeTruthy();
  });

  it("treats a corrupted pending-login stash as no pending login at all", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(tokenResponse({ access_token: "at", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetchMock);
    sessionStorage.setItem("clip-extractor.oauth-pkce.v1", "{not json");
    window.history.replaceState({}, "", "/?code=the-code&state=some-state");
    expect(await handleRedirectCallback()).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
    // Consumed either way: a corrupted stash is not left around to confuse the next callback.
    expect(sessionStorage.getItem("clip-extractor.oauth-pkce.v1")).toBe(null);
  });

  it("refuses a callback whose state doesn't match the one it sent (CSRF guard)", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(tokenResponse({ access_token: "at", expires_in: 3600 })));
    vi.stubGlobal("fetch", fetchMock);
    await startLogin(() => {});
    window.history.replaceState({}, "", "/?code=the-code&state=not-the-state");
    expect(await handleRedirectCallback()).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ensureFreshToken", () => {
  it("keeps a token that is not near expiry", async () => {
    const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3_600_000 };
    expect(await ensureFreshToken(tokens)).toBe(tokens);
  });

  it("refreshes an expired token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(tokenResponse({ access_token: "fresh", refresh_token: "rt2", expires_in: 3600 }))),
    );
    const refreshed = await ensureFreshToken({ accessToken: "old", refreshToken: "rt", expiresAt: Date.now() - 1 });
    expect(refreshed.accessToken).toBe("fresh");
  });

  it("keeps an expired token that has no refresh token to spend", async () => {
    const tokens = { accessToken: "at", expiresAt: Date.now() - 1 };
    expect(await ensureFreshToken(tokens)).toBe(tokens);
  });

  it("throws when the refresh is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(tokenResponse({}, false, 400))),
    );
    await expect(ensureFreshToken({ accessToken: "at", refreshToken: "rt", expiresAt: 0 })).rejects.toThrow(/HTTP 400/);
  });
});

describe("revokeToken", () => {
  it("asks the archive to revoke the access token", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(tokenResponse({})));
    vi.stubGlobal("fetch", fetchMock);
    await revokeToken({ accessToken: "at", expiresAt: Date.now() });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe(`${EMBER_INSTANCE.oauth}/revoke_token/`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("token")).toBe("at");
    expect(body.get("token_type_hint")).toBe("access_token");
    expect(body.get("client_id")).toBe(OAUTH_CLIENT_ID);
  });

  it("swallows a failure, the local state being cleared regardless", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    await expect(revokeToken({ accessToken: "at", expiresAt: Date.now() })).resolves.toBeUndefined();
  });
});
