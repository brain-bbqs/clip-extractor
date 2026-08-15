import { test, expect, type Page } from "@playwright/test";
import { recordClipBytes } from "./helpers";

// The browse pane reads EMBER's and DANDI's public S3 buckets directly (see lib/archives.ts), so
// these specs stub the two buckets: a ListObjectsV2 listing, a `dandiset.jsonld` per dataset and an
// `assets.jsonld` per dataset version, in the same shapes the real buckets serve.

const EMBER_BUCKET = "https://ember-dandi-archive.s3.amazonaws.com";
const DANDI_BUCKET = "https://dandiarchive.s3.us-east-2.amazonaws.com";
const CLIP_URL = `${EMBER_BUCKET}/blobs/f16/d2f/f16d2f83`;

interface StubDataset {
  id: string;
  name: string;
  /** Asset paths in the dataset, video or not. */
  paths: string[];
  /** Size of the dataset's `assets.jsonld`, as the listing reports it. */
  manifestBytes?: number;
}

function listingXml(datasets: StubDataset[]): string {
  const contents = datasets
    .flatMap((d) => [
      `<Contents><Key>dandisets/${d.id}/draft/assets.jsonld</Key><Size>${d.manifestBytes ?? 4096}</Size></Contents>`,
      `<Contents><Key>dandisets/${d.id}/draft/dandiset.jsonld</Key><Size>1200</Size></Contents>`,
    ])
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

function assetsJson(bucket: string, paths: string[]): string {
  return JSON.stringify(
    paths.map((path, i) => ({
      path,
      contentSize: 1024 * (i + 1),
      encodingFormat: path.endsWith(".mp4") ? "video/mp4" : "application/x-nwb",
      // The bucket URL has to be the one the asset's own archive serves, or the pane is right to
      // leave the asset out — which is why this follows `bucket` rather than a fixed host.
      contentUrl: [`https://api.example.org/api/assets/asset-${i}/download/`, `${bucket}/blobs/${path.endsWith(".mp4") ? "f16/d2f/f16d2f83" : `a/b/${i}`}`],
    })),
  );
}

/** Serves one bucket's listing and manifests. Requests for blobs are left alone, so a spec can
 * route the video itself. */
async function stubBucket(page: Page, bucket: string, datasets: StubDataset[]): Promise<void> {
  await page.route(`${bucket}/**`, (route) => {
    const url = new URL(route.request().url());
    const xml = (body: string) => route.fulfill({ status: 200, contentType: "application/xml", body });
    const json = (body: string) => route.fulfill({ status: 200, contentType: "application/json", body });
    if (url.searchParams.get("list-type") === "2") return xml(listingXml(datasets));
    const dataset = datasets.find((d) => url.pathname.startsWith(`/dandisets/${d.id}/`));
    if (!dataset) return route.continue();
    if (url.pathname.endsWith("/dandiset.jsonld")) return json(JSON.stringify({ name: dataset.name }));
    if (url.pathname.endsWith("/assets.jsonld")) return json(assetsJson(bucket, dataset.paths));
    return route.continue();
  });
}

const EMBER_DATASETS: StubDataset[] = [
  { id: "000265", name: "Mouse open field", paths: ["sub-1/mice.mp4", "sub-1/sub-1_behavior.nwb"] },
  { id: "000299", name: "Gerbil vocalizations", paths: ["sub-G1/sub-G1_behavior.nwb"] },
];

test("browsing EMBER lists its datasets, marks which hold video, and narrows to them", async ({ page }) => {
  await stubBucket(page, EMBER_BUCKET, EMBER_DATASETS);
  await page.goto("/");

  await page.locator('#srcSeg button[data-src="browse"]').click();
  await expect(page.locator("#browsePane")).toBeVisible();
  await expect(page.locator("#dropzone")).toBeHidden();

  // EMBER's manifests are small enough to read wholesale, so every dataset is scanned for video up
  // front and the "with video only" switch appears once that finishes.
  await expect(page.locator("#browseStatus")).toHaveText("1 of 2 EMBER datasets hold video.");
  await expect(page.locator("#browseVideosOnlyRow")).toBeVisible();
  const rows = page.locator("#browseDandisets .browse-item");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Mouse open field");
  await expect(rows.first()).toContainText("1 video");

  await page.locator("#browseVideosOnly").uncheck();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("no video");
});

test("the filter matches a dataset by number, by title and by the files in it", async ({ page }) => {
  await stubBucket(page, EMBER_BUCKET, EMBER_DATASETS);
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();
  await expect(page.locator("#browseVideosOnlyRow")).toBeVisible();
  await page.locator("#browseVideosOnly").uncheck();

  const rows = page.locator("#browseDandisets .browse-item");
  await page.locator("#browseFilter").fill("000299");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Gerbil vocalizations");

  await page.locator("#browseFilter").fill("open field");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("000265");

  await page.locator("#browseFilter").fill("mice.mp4");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("000265");

  await page.locator("#browseFilter").fill("nothing here");
  await expect(page.locator("#browseDandisets .browse-empty")).toContainText("No dataset matches");
});

test("choosing a dataset lists only its videos, and choosing one streams it onto the stage", async ({ page }) => {
  await stubBucket(page, EMBER_BUCKET, EMBER_DATASETS);
  await page.goto("/");
  const clip = await recordClipBytes(page);
  await page.route(CLIP_URL, (route) => route.fulfill({ status: 200, contentType: "video/webm", body: clip }));

  await page.locator('#srcSeg button[data-src="browse"]').click();
  await page.locator("#browseDandisets .browse-item").first().click();

  await expect(page.locator("#browseVideoHeading")).toHaveText("Videos in 000265");
  await expect(page.locator("#browseDandisetLink")).toHaveAttribute("href", "https://dandi.emberarchive.org/dandiset/000265/draft");
  const videos = page.locator("#browseVideos .browse-item");
  await expect(videos).toHaveCount(1);
  await expect(videos.first()).toContainText("sub-1/mice.mp4");

  await videos.first().click();
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator("#emptyStage")).toBeHidden();
  await expect(page.locator("#btnPlay")).toBeEnabled();
});

test("a dataset holding no video says so instead of leaving an empty list", async ({ page }) => {
  await stubBucket(page, EMBER_BUCKET, EMBER_DATASETS);
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();
  await expect(page.locator("#browseVideosOnlyRow")).toBeVisible();
  await page.locator("#browseVideosOnly").uncheck();

  await page.locator('#browseDandisets .browse-item:has-text("000299")').click();
  await expect(page.locator("#browseVideos .browse-empty")).toContainText("no video files");
});

test("an archive too large to scan wholesale reads a dataset's file list only when it is opened", async ({ page }) => {
  await stubBucket(page, EMBER_BUCKET, EMBER_DATASETS);
  // A manifest well past the sweep budget, so DANDI behaves the way the real archive's gigabyte of
  // manifests makes it behave: no up-front scan, no "with video only" switch.
  await stubBucket(page, DANDI_BUCKET, [{ id: "000003", name: "Somewhere else entirely", paths: ["sub-Y/clip.mp4"], manifestBytes: 64 * 1024 * 1024 }]);
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();
  await page.locator('#archiveSeg button[data-archive="dandi"]').click();

  await expect(page.locator("#browseStatus")).toHaveText("1 DANDI datasets.");
  await expect(page.locator("#browseVideosOnlyRow")).toBeHidden();
  const rows = page.locator("#browseDandisets .browse-item");
  await expect(rows).toHaveCount(1);
  // Unscanned, so the row reports what opening it would cost rather than a video count.
  await expect(rows.first()).toContainText("64.00 MB");

  await rows.first().click();
  await expect(page.locator("#browseVideos .browse-item")).toHaveCount(1);
  await expect(rows.first()).toContainText("1 video");
});

test("an unreachable bucket is reported instead of an empty archive", async ({ page }) => {
  await page.route(`${EMBER_BUCKET}/**`, (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "" }));
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();
  await expect(page.locator("#browseStatus")).toContainText("Could not read the EMBER archive");
});
