import { afterEach, describe, expect, it, vi } from "vitest";
import {
  archiveSourceOf,
  blobIdFromBucketUrl,
  canSweep,
  dandisetWebUrl,
  fetchDandisetName,
  fetchDandisetVideos,
  indexDandisets,
  isVideoAsset,
  listManifestObjects,
  mergeDandisets,
  parseListing,
  pickManifestVersion,
  selectVideoAssets,
  sweepArchiveVideos,
  sweepBytes,
  EMBER_ARCHIVE,
  SWEEP_BUDGET_BYTES,
  type ArchiveDandiset,
  type ArchiveVideo,
} from "../../src/lib/archives";

function listingXml(keys: [string, number][], nextToken?: string): string {
  const contents = keys.map(([key, size]) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`).join("");
  const next = nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name>${next}${contents}</ListBucketResult>`;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: () => Promise.resolve(body) } as unknown as Response;
}

/** A dataset as the bucket listing describes it. */
function publicDandiset(id: string, manifestBytes = 1234): ArchiveDandiset {
  return { id, version: "draft", manifestBytes, embargoed: false };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseListing", () => {
  it("reads keys, sizes and the continuation token out of an S3 listing", () => {
    const page = parseListing(listingXml([["dandisets/000265/draft/assets.jsonld", 4096]], "tok"));
    expect(page.entries).toEqual([{ key: "dandisets/000265/draft/assets.jsonld", size: 4096 }]);
    expect(page.nextToken).toBe("tok");
  });

  it("reports no continuation token on the last page", () => {
    expect(parseListing(listingXml([["dandisets/000265/draft/assets.jsonld", 1]])).nextToken).toBe(null);
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
      { id: "000003", version: "draft", manifestBytes: 30, embargoed: false },
      { id: "000005", version: "draft", manifestBytes: 20, embargoed: false },
    ]);
  });

  it("ignores keys that are not a dataset version's asset manifest", () => {
    expect(indexDandisets([{ key: "blobs/abc/def/0123", size: 5 }])).toEqual([]);
  });
});

describe("mergeDandisets", () => {
  const owned: ArchiveDandiset = { id: "000265", version: "draft", manifestBytes: 0, embargoed: true, name: "Mine" };

  it("lists the public datasets and the signed-in visitor's own together, by identifier", () => {
    expect(mergeDandisets([publicDandiset("000299")], [owned]).map((d) => d.id)).toEqual(["000265", "000299"]);
  });

  it("lets the owned entry replace the unreadable public listing of the same dataset", () => {
    // An embargoed dataset's manifests are listed publicly but refuse to be read, so the bucket
    // knows it exists and nothing more; the API listing is the one that knows anything about it.
    const merged = mergeDandisets([publicDandiset("000265")], [owned]);
    expect(merged).toEqual([owned]);
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
    expect(selectVideoAssets("000265", manifest)).toEqual([
      {
        dandisetId: "000265",
        path: "sub-1/mice.mp4",
        size: 31258120,
        streamUrl: "https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83",
        assetUrl: "https://api-dandi.emberarchive.org/api/assets/1e002c85/download/",
        embargoed: false,
      },
    ]);
  });

  it("picks the bucket URL by which bucket it points at, not by its position in the list", () => {
    const reordered = [{ ...manifest[0], contentUrl: [...manifest[0].contentUrl].reverse() }];
    expect(selectVideoAssets("000265", reordered)[0].streamUrl).toBe("https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83");
  });

  it("cites the bucket URL when the archive lists no other one", () => {
    const onlyS3 = [{ ...manifest[0], contentUrl: ["https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83"] }];
    expect(selectVideoAssets("000265", onlyS3)[0].assetUrl).toBe("https://ember-dandi-archive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83");
  });

  it("drops a video whose bytes are not on this archive's bucket", () => {
    const elsewhere = [{ ...manifest[0], contentUrl: ["https://dandiarchive.s3.amazonaws.com/blobs/f16/d2f/f16d2f83"] }];
    expect(selectVideoAssets("000265", elsewhere)).toEqual([]);
  });

  it("survives a manifest that is not the list of assets it should be", () => {
    expect(selectVideoAssets("000265", { error: "AccessDenied" })).toEqual([]);
    expect(selectVideoAssets("000265", [null, { path: 7 }])).toEqual([]);
  });
});

describe("sweep affordability", () => {
  const datasets = (bytesEach: number, count: number): ArchiveDandiset[] =>
    Array.from({ length: count }, (_, i) => publicDandiset(String(i).padStart(6, "0"), bytesEach));

  it("adds up what reading every manifest would cost", () => {
    expect(sweepBytes(datasets(1000, 4))).toBe(4000);
  });

  it("allows a sweep of an archive whose manifests are small, as EMBER's are", () => {
    expect(canSweep(datasets(10_000, 30))).toBe(true);
  });

  it("refuses one whose manifests have grown past what a browser should read wholesale", () => {
    expect(canSweep(datasets(SWEEP_BUDGET_BYTES, 2))).toBe(false);
  });

  it("counts an embargoed dataset as free, since no manifest is read for it", () => {
    expect(sweepBytes([{ id: "000265", version: "draft", manifestBytes: 0, embargoed: true }])).toBe(0);
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
          textResponse(
            first
              ? listingXml([["dandisets/000265/draft/assets.jsonld", 1]], "page2")
              : listingXml([["dandisets/000299/draft/assets.jsonld", 2]]),
          ),
        );
      }),
    );
    const entries = await listManifestObjects();
    expect(entries.map((e) => e.key)).toEqual(["dandisets/000265/draft/assets.jsonld", "dandisets/000299/draft/assets.jsonld"]);
    expect(urls[0].startsWith(`${EMBER_ARCHIVE.origin}/?`)).toBe(true);
    expect(urls[1].includes("continuation-token=page2")).toBe(true);
  });

  it("reports an unreachable bucket rather than returning an empty archive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(textResponse("", false, 503))),
    );
    await expect(listManifestObjects()).rejects.toThrow(/HTTP 503/);
  });
});

describe("reading a dataset's manifests", () => {
  const dandiset = publicDandiset("000265");

  it("reads a dataset's title from the version it indexed", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(textResponse(JSON.stringify({ name: "Clip extractor test data" }))));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchDandisetName(dandiset)).toBe("Clip extractor test data");
    expect(fetchMock.mock.calls[0][0]).toBe(`${EMBER_ARCHIVE.origin}/dandisets/000265/draft/dandiset.jsonld`);
  });

  it("leaves a dataset unnamed rather than failing when its manifest is not readable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(textResponse("", false, 403))),
    );
    expect(await fetchDandisetName(dandiset)).toBe(null);
  });

  it("reads the videos in a dataset out of its asset manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          textResponse(
            JSON.stringify([
              { path: "sub-1/mice.mp4", contentSize: 5, contentUrl: ["https://ember-dandi-archive.s3.amazonaws.com/blobs/a/b/c"] },
            ]),
          ),
        ),
      ),
    );
    expect((await fetchDandisetVideos(dandiset)).map((v) => v.path)).toEqual(["sub-1/mice.mp4"]);
  });
});

describe("sweepArchiveVideos", () => {
  const video = (dandisetId: string): ArchiveVideo => ({
    dandisetId,
    path: "a.mp4",
    size: 1,
    assetUrl: "https://api.example.org/api/assets/a/download/",
    streamUrl: "https://ember-dandi-archive.s3.amazonaws.com/blobs/a",
    embargoed: false,
  });

  it("reports every dataset, including the ones whose file list could not be read", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const seen = new Map<string, ArchiveVideo[]>();
      const done = sweepArchiveVideos(
        [publicDandiset("000265"), publicDandiset("000299")],
        (dandiset) => (dandiset.id === "000265" ? Promise.resolve([video(dandiset.id)]) : Promise.reject(new Error("HTTP 403"))),
        (dandiset, videos) => seen.set(dandiset.id, videos),
      );
      await vi.runAllTimersAsync();
      await done;
      expect(seen.get("000265")?.length).toBe(1);
      expect(seen.get("000299")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed read before giving up, so a transient hiccup does not hide a public dataset", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const seen = new Map<string, ArchiveVideo[]>();
      const done = sweepArchiveVideos(
        [publicDandiset("000265")],
        () => {
          attempts++;
          // Cold-cache conditions (incognito, a first visit) make the first attempt or two fail
          // even though the dataset is genuinely public and readable.
          if (attempts < 3) return Promise.reject(new Error("network error"));
          return Promise.resolve([video("000265")]);
        },
        (dandiset, videos) => seen.set(dandiset.id, videos),
      );
      await vi.runAllTimersAsync();
      await done;
      expect(attempts).toBe(3);
      expect(seen.get("000265")?.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up and reports no videos once retries are exhausted, e.g. for a dataset embargoed against the visitor", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const seen = new Map<string, ArchiveVideo[]>();
      const done = sweepArchiveVideos(
        [publicDandiset("000900")],
        () => Promise.reject(new Error("HTTP 403")),
        (dandiset, videos) => seen.set(dandiset.id, videos),
      );
      await vi.runAllTimersAsync();
      await done;
      expect(seen.get("000900")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the reader it is given, so an embargoed dataset can be read a different way", async () => {
    const asked: string[] = [];
    await sweepArchiveVideos(
      [publicDandiset("000265"), { id: "000900", version: "draft", manifestBytes: 0, embargoed: true }],
      (dandiset) => {
        asked.push(`${dandiset.id}:${String(dandiset.embargoed)}`);
        return Promise.resolve([]);
      },
      () => {},
    );
    expect(asked.sort()).toEqual(["000265:false", "000900:true"]);
  });
});

describe("dandisetWebUrl", () => {
  it("points at the dataset's own page in the archive", () => {
    expect(dandisetWebUrl(publicDandiset("000265"))).toBe("https://dandi.emberarchive.org/dandiset/000265/draft");
  });
});

describe("blobIdFromBucketUrl / archiveSourceOf", () => {
  const BLOB = "ca563ad5-7f29-4c90-8df5-a23a5446ea13";

  it("reads the blob id off the end of a bucket URL", () => {
    expect(blobIdFromBucketUrl(`https://bucket.example/blobs/ca5/63a/${BLOB}`)).toBe(BLOB);
  });

  it("ignores a query string on the way", () => {
    expect(blobIdFromBucketUrl(`https://bucket.example/blobs/ca5/63a/${BLOB}?X-Amz-Signature=abc`)).toBe(BLOB);
  });

  it("names nothing for a URL whose last segment is not a blob id, rather than guessing", () => {
    expect(blobIdFromBucketUrl("https://api.example/api/assets/asset-3/download/")).toBeNull();
    expect(blobIdFromBucketUrl("https://bucket.example/blobs/a/b/3")).toBeNull();
    expect(blobIdFromBucketUrl(null)).toBeNull();
  });

  it("carries the dandiset, the path and the blob a listed video came from", () => {
    expect(
      archiveSourceOf({
        dandisetId: "000479",
        path: "sub-01/mice.mp4",
        size: 1,
        assetUrl: "https://api.example/api/assets/asset-3/download/",
        streamUrl: `https://bucket.example/blobs/ca5/63a/${BLOB}`,
        embargoed: false,
      }),
    ).toEqual({ dandisetId: "000479", path: "sub-01/mice.mp4", blobId: BLOB });
  });

  it("leaves the blob unnamed for an embargoed asset, whose bucket URL is signed on demand", () => {
    expect(
      archiveSourceOf({
        dandisetId: "000479",
        path: "sub-01/mice.mp4",
        size: 1,
        assetUrl: "https://api.example/api/assets/asset-3/download/",
        streamUrl: null,
        embargoed: true,
      }).blobId,
    ).toBeNull();
  });
});
