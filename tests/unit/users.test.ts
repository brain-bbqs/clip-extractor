import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArchiveUser } from "../../src/lib/users";
import type { ArchiveConfig } from "../../src/lib/types";

const cfg: ArchiveConfig = {
  api: "https://api.example.org/api",
  web: "https://example.org",
  accessToken: "tok",
  dandisetId: "",
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchArchiveUser", () => {
  it("asks the archive who the token belongs to", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ username: "ada", name: "Ada Lovelace" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchArchiveUser(cfg)).toEqual({ username: "ada", name: "Ada Lovelace" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.example.org/api/users/me/");
  });

  it("treats the identity as unknown without a token, never calling the archive", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchArchiveUser({ ...cfg, accessToken: "" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an answer naming no user as unknown rather than failing", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse({})));
    expect(await fetchArchiveUser(cfg)).toBeNull();
  });

  it("carries a null display name for an account the archive names only by username", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse({ username: "ada" })));
    expect(await fetchArchiveUser(cfg)).toEqual({ username: "ada", name: null });
  });
});
