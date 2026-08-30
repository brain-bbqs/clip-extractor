import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, listedTitle } from "../../src/lib/api";
import { ApiError } from "../../src/lib/errors";
import type { ArchiveConfig } from "../../src/lib/types";

const cfg: ArchiveConfig = {
  api: "https://api.example.org/api",
  web: "https://example.org",
  accessToken: "tok",
  dandisetId: "",
};

function response(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("calls the archive with the bearer token and hands back the parsed answer", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);
    expect(await apiFetch(cfg, "/info/")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.example.org/api/info/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("sends a signed-out call as a real anonymous request, with no Authorization header at all", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch({ ...cfg, accessToken: "" }, "/info/");
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("Authorization");
  });

  it("serializes a JSON body and labels it as one", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response("{}")));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch(cfg, "/assets/", { method: "POST", json: { path: "a.mp4" } });
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"path":"a.mp4"}');
  });

  it("returns null for a 204, which carries no body to parse", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(response("", true, 204)));
    expect(await apiFetch(cfg, "/assets/a1/")).toBeNull();
  });

  it("turns a failed call into an ApiError quoting the status and the server's own detail", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(response('{"detail":"no such dataset"}', false, 404)));
    const failure = apiFetch(cfg, "/dandisets/000999/");
    await expect(failure).rejects.toThrow(ApiError);
    await expect(failure).rejects.toThrow(/GET \/dandisets\/000999\/ failed with HTTP 404: .*no such dataset/);
    await expect(failure).rejects.toMatchObject({ status: 404 });
  });

  it("still reports the status when the failure's body cannot even be read", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: false, status: 502, text: () => Promise.reject(new Error("gone")) } as unknown as Response),
    );
    await expect(apiFetch(cfg, "/info/")).rejects.toThrow("GET /info/ failed with HTTP 502");
  });

  it("turns a network failure into an ApiError pointing at the connection, with status 0", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    const failure = apiFetch(cfg, "/info/");
    await expect(failure).rejects.toThrow(/Network error calling \/info\/.*Failed to fetch/);
    await expect(failure).rejects.toMatchObject({ status: 0 });
  });

  it("stringifies even a rejection that is not an Error at all", async () => {
    vi.stubGlobal("fetch", () => Promise.reject("socket hangup"));
    await expect(apiFetch(cfg, "/info/")).rejects.toThrow(/socket hangup/);
  });
});

describe("listedTitle", () => {
  it("prefers the published name, the more considered of the two", () => {
    expect(
      listedTitle({ identifier: "000001", most_recent_published_version: { name: "Published" }, draft_version: { name: "Draft" } }),
    ).toBe("Published");
  });

  it("falls back to the draft's name, every dandiset having a draft", () => {
    expect(listedTitle({ identifier: "000001", draft_version: { name: "Draft" } })).toBe("Draft");
  });

  it("answers nothing for a dandiset naming neither", () => {
    expect(listedTitle({ identifier: "000001" })).toBe("");
  });
});
