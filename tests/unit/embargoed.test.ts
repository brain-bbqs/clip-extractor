import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAssetDownloadUrl,
  listEmbargoedVideos,
  listOwnedEmbargoedDandisets,
  listPublicDandisetIds,
  resolveEmbargoedStreamUrl,
} from "../../src/lib/embargoed";
import type { ArchiveConfig } from "../../src/lib/types";

const cfg: ArchiveConfig = {
  api: "https://api.example.org/api",
  web: "https://example.org",
  accessToken: "tok",
  dandisetId: "",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve("") } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listOwnedEmbargoedDandisets", () => {
  /** Stubs the dandiset listing and, per dandiset, the owner list the result is checked against. */
  function stub(results: unknown[], owners: Record<string, string[] | "error"> = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((input: string) => {
      const url = String(input);
      const match = /\/dandisets\/(\d+)\/users\//.exec(url);
      if (match) {
        const listed = owners[match[1]] ?? [];
        if (listed === "error") return Promise.resolve(jsonResponse({}, false, 500));
        return Promise.resolve(jsonResponse(listed.map((username) => ({ username }))));
      }
      return Promise.resolve(jsonResponse({ results }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("keeps only the embargoed ones the visitor is listed against, ordered by identifier", async () => {
    stub(
      [
        { identifier: "000900", embargo_status: "EMBARGOED", draft_version: { name: "Incoming: Test Lab" } },
        { identifier: "000265", embargo_status: "OPEN", draft_version: { name: "Already public" } },
        { identifier: "000800", embargo_status: "EMBARGOED", draft_version: { name: "Staging" } },
      ],
      { "000900": ["ada"], "000800": ["ada", "grace"] },
    );
    expect(await listOwnedEmbargoedDandisets(cfg, "ada")).toEqual([
      { id: "000800", version: "draft", manifestBytes: 0, embargoed: true, name: "Staging" },
      { id: "000900", version: "draft", manifestBytes: 0, embargoed: true, name: "Incoming: Test Lab" },
    ]);
  });

  // The archive resolves `?user=me` through object permissions, which a superuser holds globally,
  // so an admin's listing comes back holding the whole archive's embargoed datasets.
  it("drops an embargoed dataset the visitor is not listed against, however it was returned", async () => {
    stub(
      [
        { identifier: "000900", embargo_status: "EMBARGOED", draft_version: { name: "Mine" } },
        { identifier: "000901", embargo_status: "EMBARGOED", draft_version: { name: "Somebody else's" } },
      ],
      { "000900": ["ada"], "000901": ["grace"] },
    );
    expect((await listOwnedEmbargoedDandisets(cfg, "ada")).map((d) => d.id)).toEqual(["000900"]);
  });

  it("drops a dataset whose owner list cannot be read, rather than guessing it is yours", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stub([{ identifier: "000900", embargo_status: "EMBARGOED", draft_version: { name: "Mine" } }], { "000900": "error" });
    expect(await listOwnedEmbargoedDandisets(cfg, "ada")).toEqual([]);
  });

  it("offers nothing when there is no signed-in account to check against", async () => {
    const fetchMock = stub([{ identifier: "000900", embargo_status: "EMBARGOED", draft_version: { name: "Mine" } }], { "000900": ["ada"] });
    expect(await listOwnedEmbargoedDandisets(cfg, "")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks only for the datasets the signed-in visitor owns", async () => {
    const fetchMock = stub([]);
    await listOwnedEmbargoedDandisets(cfg, "ada");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.example.org/api/dandisets/?user=me&embargoed=true&page_size=1000");
  });

  it("has nothing to offer when the visitor owns nothing embargoed", async () => {
    stub([{ identifier: "000265", embargo_status: "OPEN", draft_version: { name: "Public" } }]);
    expect(await listOwnedEmbargoedDandisets(cfg, "ada")).toEqual([]);
  });
});

describe("listPublicDandisetIds", () => {
  it("collects every identifier across pages, calling anonymously even when the visitor is signed in", async () => {
    const fetchMock = vi.fn((input: string) =>
      Promise.resolve(
        String(input).includes("page=2")
          ? jsonResponse({ results: [{ identifier: "000003" }], next: null })
          : jsonResponse({
              results: [{ identifier: "000001" }, { identifier: "000002" }],
              next: "https://api.example.org/api/dandisets/?page=2",
            }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await listPublicDandisetIds(cfg)).toEqual(new Set(["000001", "000002", "000003"]));
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.headers).not.toHaveProperty("Authorization");
    }
  });

  it("stops rather than following a next page pointing at another host", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ results: [{ identifier: "000001" }], next: "https://elsewhere.example/api/dandisets/" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await listPublicDandisetIds(cfg)).toEqual(new Set(["000001"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("listEmbargoedVideos", () => {
  it("keeps the videos out of the API's asset listing, following its pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(
          String(input).includes("page=2")
            ? jsonResponse({ results: [{ asset_id: "a3", path: "sub-1/second.avi", size: 3 }], next: null })
            : jsonResponse({
                results: [
                  { asset_id: "a1", path: "sub-1/first.mp4", size: 1 },
                  { asset_id: "a2", path: "sub-1/sub-1_behavior.nwb", size: 2 },
                ],
                next: "https://api.example.org/api/dandisets/000900/versions/draft/assets/?page=2",
              }),
        ),
      ),
    );
    expect(await listEmbargoedVideos(cfg, "000900")).toEqual([
      {
        dandisetId: "000900",
        path: "sub-1/first.mp4",
        size: 1,
        assetUrl: "https://api.example.org/api/assets/a1/download/",
        streamUrl: null,
        embargoed: true,
      },
      {
        dandisetId: "000900",
        path: "sub-1/second.avi",
        size: 3,
        assetUrl: "https://api.example.org/api/assets/a3/download/",
        streamUrl: null,
        embargoed: true,
      },
    ]);
  });

  it("stops rather than following a next page pointing at another host", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ results: [{ asset_id: "a1", path: "a.mp4" }], next: "https://elsewhere.example/api/assets/" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await listEmbargoedVideos(cfg, "000900")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a size unknown when the listing does not report one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ results: [{ asset_id: "a1", path: "a.mp4" }], next: null }))),
    );
    expect((await listEmbargoedVideos(cfg, "000900"))[0].size).toBe(null);
  });
});

describe("isAssetDownloadUrl", () => {
  it("recognises this archive's own asset download endpoint, with or without its trailing slash", () => {
    expect(isAssetDownloadUrl(cfg, `${cfg.api}/assets/2f0f/download/`)).toBe(true);
    expect(isAssetDownloadUrl(cfg, `${cfg.api}/assets/2f0f/download`)).toBe(true);
  });

  it("leaves anything else alone, including another archive's assets and the bucket itself", () => {
    expect(isAssetDownloadUrl(cfg, "https://api.other.org/api/assets/2f0f/download/")).toBe(false);
    expect(isAssetDownloadUrl(cfg, "https://bucket.example.org/blobs/2f/0f/2f0f")).toBe(false);
    expect(isAssetDownloadUrl(cfg, `${cfg.api}/dandisets/000123/`)).toBe(false);
  });
});

describe("resolveEmbargoedStreamUrl", () => {
  const assetUrl = "https://api.example.org/api/assets/a1/download/";
  const signed = "https://ember-dandi-archive.s3.amazonaws.com/blobs/a/b/c?X-Amz-Signature=abc";

  function stubDownload(body: Partial<Response>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 206, body: null, ...body } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reports where the archive's redirect landed, which is the signed bucket URL", async () => {
    const fetchMock = stubDownload({ url: signed });
    expect(await resolveEmbargoedStreamUrl(cfg, assetUrl)).toBe(signed);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    // Only the first byte is asked for: the address the request ends at is the whole point of it.
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
  });

  it("releases the byte it asked for rather than holding the connection open", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    stubDownload({ url: signed, body: { cancel } as unknown as ReadableStream });
    await resolveEmbargoedStreamUrl(cfg, assetUrl);
    expect(cancel).toHaveBeenCalled();
  });

  it("says so when the archive refuses the file", async () => {
    stubDownload({ ok: false, status: 403, url: assetUrl });
    await expect(resolveEmbargoedStreamUrl(cfg, assetUrl)).rejects.toThrow(/refused .* \(HTTP 403\)/);
  });

  it("says so when the archive answers without redirecting anywhere", async () => {
    stubDownload({ url: assetUrl });
    await expect(resolveEmbargoedStreamUrl(cfg, assetUrl)).rejects.toThrow(/did not redirect/);
  });
});
