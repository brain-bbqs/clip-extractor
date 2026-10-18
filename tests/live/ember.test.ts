import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "@brain-bbqs/ember-client";
import {
  EMBER_ARCHIVE,
  fetchDandisetVideos,
  indexDandisets,
  listManifestObjects,
  type ArchiveDandiset,
  type ArchiveVideo,
} from "../../src/lib/archives";
import { listPublicDandisetIds } from "../../src/lib/embargoed";

// Whether EMBER still answers the way the browse pane reads it: the same bucket, the same API and
// the same code the deployed site runs, against the live services. The unit and integration tests
// route those hosts to fixtures, which is why they kept passing when the archive's old bucket was
// deleted out from under the site.
//
// Node's fetch enforces no CORS, so each request a browser would make cross-origin is also sent with
// the site's own Origin, and the answer is checked for the header that lets a browser read it.

/** The deployed site's origin, read from the file GitHub Pages serves the site under. Relative to the
 * package root, which npm runs every script from (under jsdom, `import.meta.url` is not a file URL). */
const SITE_ORIGIN = `https://${readFileSync("public/CNAME", "utf8").trim()}`;

/** How many public datasets' file lists are read, smallest first, while looking for a video. */
const MAX_DATASETS_SCANNED = 40;

const cfg = resolveConfig({ dandisetId: "" });

/** Memoizes a read across the tests below, forgetting a failed one so a retry reads again. */
function shared<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((e: unknown) => {
      pending = null;
      throw e;
    }));
}

const bucketDatasets = shared(async () => indexDandisets(await listManifestObjects()));
const publicIds = shared(() => listPublicDandisetIds(cfg));

/** The datasets the browse pane shows a signed-out visitor: in the bucket, and public per the API. */
async function publicDatasets(): Promise<ArchiveDandiset[]> {
  const [datasets, ids] = await Promise.all([bucketDatasets(), publicIds()]);
  return datasets.filter((d) => ids.has(d.id));
}

/**
 * The first video in the smallest public datasets' file lists. A video only counts when its file list
 * points at EMBER_ARCHIVE's bucket (selectVideoAssets drops any other), so finding one also confirms
 * the manifests still name the bucket the site reads.
 */
async function firstPublicVideo(): Promise<ArchiveVideo | undefined> {
  const smallestFirst = (await publicDatasets()).sort((a, b) => a.manifestBytes - b.manifestBytes);
  for (const dandiset of smallestFirst.slice(0, MAX_DATASETS_SCANNED)) {
    const videos = await fetchDandisetVideos(dandiset).catch((): ArchiveVideo[] => []);
    if (videos.length > 0) return videos[0];
  }
  return undefined;
}

describe("EMBER, as the browse pane reads it", () => {
  it("lets the site list the bucket's dataset manifests", async () => {
    const resp = await fetch(`${EMBER_ARCHIVE.origin}/?list-type=2&prefix=dandisets%2F&max-keys=1`, {
      headers: { Origin: SITE_ORIGIN },
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("access-control-allow-origin")).toBeOneOf(["*", SITE_ORIGIN]);
    expect((await bucketDatasets()).length).toBeGreaterThan(0);
  });

  it("lets the site ask the API which datasets are public, and the bucket holds some of them", async () => {
    const resp = await fetch(`${cfg.api}/info/`, { headers: { Origin: SITE_ORIGIN } });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("access-control-allow-origin")).toBeOneOf(["*", SITE_ORIGIN]);
    expect((await publicDatasets()).length).toBeGreaterThan(0);
  });

  it("finds a public video on the bucket and lets the site stream it", async () => {
    const video = await firstPublicVideo();
    expect(video, `no video in the ${MAX_DATASETS_SCANNED} smallest public datasets`).toBeDefined();
    const resp = await fetch(video!.streamUrl, { headers: { Origin: SITE_ORIGIN, Range: "bytes=0-0" } });
    await resp.body?.cancel();
    expect(resp.status).toBe(206);
    expect(resp.headers.get("access-control-allow-origin")).toBeOneOf(["*", SITE_ORIGIN]);
  });
});
