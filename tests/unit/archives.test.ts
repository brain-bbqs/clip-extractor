import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveById,
  canSweep,
  dandisetWebUrl,
  fetchDandisetName,
  fetchDandisetVideos,
  indexDandisets,
  isVideoAsset,
  listManifestObjects,
  parseListing,
  pickManifestVersion,
  selectVideoAssets,
  sweepArchiveVideos,
  sweepBytes,
  SWEEP_BUDGET_BYTES,
  type ArchiveDandiset,
  type ArchiveVideo,
} from "../../src/lib/archives";

const ember = archiveById("ember");
const dandi = archiveById("dandi");

function listingXml(keys: [string, number][], nextToken?: string): string {
  const contents = keys.map(([key, size]) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`).join("");
  const next = nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name>${next}${contents}</ListBucketResult>`;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: () => Promise.resolve(body) } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseListing", () => {
  it("reads keys, sizes and the continuation token out of an S3 listing", () => {
    const page = parseListing(listingXml([["dandisets/000003/draft/assets.jsonld", 4096]], "tok"));
    expect(page.entries).toEqual([{ key: "dandisets/000003/draft/assets.jsonld", size: 4096 }]);
    expect(page.nextToken).toBe("tok");
  });

  it("reports no continuation token on the last page", () => {
    expect(parseListing(listingXml([["dandisets/000003/draft/assets.jsonld", 1]])).nextToken).toBe(null);
  });

  it("refuses a body that is not XML at all", () => {
    expect(() => parseListing("<<not xml")).toThrow(/could not be parsed/);
  });
});

describe("pickManifestVersion", () => {
  it("prefers the draft, which tracks what a dataset holds now", () => {
    expect(pickManifestVersion(["0.230629.1955", "draft", "0.250624.0409"])).toBe("draft");
  });

  it("falls back to the newest published version when there is no draft", () => {
    expect(pickManifestVersion(["0.230629.1955", "0.250624.0409", "0.210812.1448"])).toBe("0.250624.0409");
  });

  it("has nothing to read when a dataset publishes no manifest at all", () => {
    expect(pickManifestVersion([])).toBe(null);
  });
});

describe("indexDandisets", () => {
  it("folds a listing into one entry per dataset, carrying that version's manifest size", () => {
    const datasets = indexDandisets([
      { key: "dandisets/000005/0.250402.1850/assets.jsonld", size: 10 },
      { key: "dandisets/000005/draft/assets.jsonld", size: 20 },
      { key: "dandisets/000005/draft/dandiset.jsonld", size: 1 },
      { key: "dandisets/000003/draft/assets.jsonld", size: 30 },
    ]);
    expect(datasets).toEqual([
      { id: "000003", version: "draft", manifestBytes: 30 },
      { id: "000005", version: "draft", manifestBytes: 20 },
    ]);
  });

  it("ignores keys that are not a dataset version's asset manifest", () => {
    expect(indexDandisets([{ key: "blobs/abc/def/0123", size: 5 }])).toEqual([]);
  });
});

describe("isVideoAsset", () => {
  it("takes the manifest's own encoding format when it names one", () => {
    expect(isVideoAsset("sub-1/recording.dat", "video/mp4")).toBe(true);
  });

  it("falls back to the container the path names", () => {
    expect(isVideoAsset("sub-1/mice.MP4")).toBe(true);
    expect(isVideoAsset("sub-1/annotated_frames.avi")).toBe(true);
  });

  it("leaves everything else out", () => {
    expect(isVideoAsset("sub-1/sub-1_behavior.nwb", "application/x-nwb")).toBe(false);
  });
});

describe("selectVideoAssets", () => {
  const manifest = [
    {
      path: "sub-1/mice.mp4",
      contentSize: 31258120,
      encodingFormat: "video/mp4",
      contentUrl: [
        "https://api-dandi.emberarchive.org/api/assets/1e002c85/download/",
        "https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83",
      ],
    },
    { path: "sub-1/sub-1_behavior.nwb", contentSize: 12, contentUrl: ["https://ember-dandi-archive.s3.amazonaws.com/blobs/a/b/c"] },
  ];

  it("keeps only the videos, streaming from the bucket and citing the archive's own URL", () => {
    expect(selectVideoAssets(ember, "000265", manifest)).toEqual([
      {
        archiveId: "ember",
        dandisetId: "000265",
        path: "sub-1/mice.mp4",
        size: 31258120,
        streamUrl: "https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83",
        assetUrl: "https://api-dandi.emberarchive.org/api/assets/1e002c85/download/",
      },
    ]);
  });

  it("picks the bucket URL by which bucket it points at, not by its position in the list", () => {
    const reordered = [{ ...manifest[0], contentUrl: [...manifest[0].contentUrl].reverse() }];
    expect(selectVideoAssets(ember, "000265", reordered)[0].streamUrl).toBe(
      "https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83",
    );
  });

  it("cites the bucket URL when the archive lists no other one", () => {
    const onlyS3 = [{ ...manifest[0], contentUrl: ["https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83"] }];
    expect(selectVideoAssets(ember, "000265", onlyS3)[0].assetUrl).toBe("https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83");
  });

  it("drops a video whose bytes are not on this archive's bucket", () => {
    expect(selectVideoAssets(dandi, "000265", manifest)).toEqual([]);
  });

  it("survives a manifest that is not the list of assets it should be", () => {
    expect(selectVideoAssets(ember, "000265", { error: "AccessDenied" })).toEqual([]);
    expect(selectVideoAssets(ember, "000265", [null, { path: 7 }])).toEqual([]);
  });
});

describe("sweep affordability", () => {
  const datasets = (bytesEach: number, count: number): ArchiveDandiset[] =>
    Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(6, "0"), version: "draft", manifestBytes: bytesEach }));

  it("adds up what reading every manifest would cost", () => {
    expect(sweepBytes(datasets(1000, 4))).toBe(4000);
  });

  it("allows a sweep of an archive whose manifests are small, like EMBER's", () => {
    expect(canSweep(datasets(10_000, 30))).toBe(true);
  });

  it("refuses one whose manifests run to hundreds of megabytes, like DANDI's", () => {
    expect(canSweep(datasets(SWEEP_BUDGET_BYTES, 2))).toBe(false);
  });
});

describe("listManifestObjects", () => {
  it("follows continuation tokens until the listing runs out", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        urls.push(String(input));
        const first = !String(input).includes("continuation-token");
        return Promise.resolve(
          textResponse(first ? listingXml([["dandisets/000003/draft/assets.jsonld", 1]], "page2") : listingXml([["dandisets/000004/draft/assets.jsonld", 2]])),
        );
      }),
    );
    const entries = await listManifestObjects(ember);
    expect(entries.map((e) => e.key)).toEqual(["dandisets/000003/draft/assets.jsonld", "dandisets/000004/draft/assets.jsonld"]);
    expect(urls[0].startsWith(`${ember.origin}/?`)).toBe(true);
    expect(urls[1].includes("continuation-token=page2")).toBe(true);
  });

  it("reports an unreadable bucket rather than returning an empty archive", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(textResponse("", false, 503))));
    await expect(listManifestObjects(ember)).rejects.toThrow(/HTTP 503/);
  });
});

describe("reading a dataset's manifests", () => {
  const dandiset: ArchiveDandiset = { id: "000265", version: "draft", manifestBytes: 1234 };

  it("reads a dataset's title from the version it indexed", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(textResponse(JSON.stringify({ name: "Clip extractor test data" }))));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchDandisetName(ember, dandiset)).toBe("Clip extractor test data");
    expect(fetchMock.mock.calls[0][0]).toBe(`${ember.origin}/dandisets/000265/draft/dandiset.jsonld`);
  });

  it("leaves a dataset unnamed rather than failing when its manifest is not readable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(textResponse("", false, 403))));
    expect(await fetchDandisetName(ember, dandiset)).toBe(null);
  });

  it("reads the videos in a dataset out of its asset manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          textResponse(
            JSON.stringify([{ path: "sub-1/mice.mp4", contentSize: 5, contentUrl: ["https://ember-dandi-archive.s3.amazonaws.com/blobs/a/b/c"] }]),
          ),
        ),
      ),
    );
    const videos = await fetchDandisetVideos(ember, dandiset);
    expect(videos.map((v) => v.path)).toEqual(["sub-1/mice.mp4"]);
  });
});

describe("sweepArchiveVideos", () => {
  it("reports every dataset, including the ones whose manifest could not be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        Promise.resolve(
          String(input).includes("000265")
            ? textResponse(JSON.stringify([{ path: "a.mp4", contentSize: 1, contentUrl: ["https://ember-dandi-archive.s3.amazonaws.com/blobs/a"] }]))
            : textResponse("", false, 403),
        ),
      ),
    );
    const seen = new Map<string, ArchiveVideo[]>();
    await sweepArchiveVideos(
      ember,
      [
        { id: "000265", version: "draft", manifestBytes: 1 },
        { id: "000299", version: "draft", manifestBytes: 1 },
      ],
      (dandiset, videos) => seen.set(dandiset.id, videos),
    );
    expect(seen.get("000265")?.length).toBe(1);
    expect(seen.get("000299")).toEqual([]);
  });
});

describe("dandisetWebUrl", () => {
  it("points at the dataset's own page in the archive that holds it", () => {
    expect(dandisetWebUrl(dandi, { id: "000003", version: "draft", manifestBytes: 0 })).toBe("https://dandiarchive.org/dandiset/000003/draft");
  });
});
