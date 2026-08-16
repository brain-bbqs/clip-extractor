import { test, expect, type Page } from "@playwright/test";
import { recordClipBytes } from "./helpers";

// The browse pane has two halves. The public one reads EMBER's public S3 bucket (see
// lib/archives.ts), so these specs stub the bucket: a ListObjectsV2 listing, a `dandiset.jsonld`
// per dataset and an `assets.jsonld` per dataset version, in the shapes the real bucket serves.
// The other reads the archive's API for the embargoed datasets a signed-in visitor owns (see
// lib/embargoed.ts), which is stubbed alongside it.

const BUCKET = "https://ember-dandi-archive.s3.amazonaws.com";
const API = "https://api-dandi.emberarchive.org/api";
const CLIP_URL = `${BUCKET}/blobs/f16/d2f/f16d2f83`;

interface StubDataset {
  id: string;
  name: string;
  /** Asset paths in the dataset, video or not. */
  paths: string[];
}

const PUBLIC_DATASETS: StubDataset[] = [
  { id: "000265", name: "Mouse open field", paths: ["sub-1/mice.mp4", "sub-1/sub-1_behavior.nwb"] },
  { id: "000299", name: "Gerbil vocalizations", paths: ["sub-G1/calls.mp4", "sub-G1/sub-G1_behavior.nwb"] },
  { id: "000005", name: "Ephys only", paths: ["sub-E/sub-E_ecephys.nwb"] },
];

/** Owned, embargoed, and so invisible in the bucket: its manifests are listed there but refuse to
 * be read, which is what makes the API the only way to see anything about it. */
const OWNED_DATASET: StubDataset = { id: "000900", name: "Incoming: Test Lab", paths: ["sub-A/held.mp4"] };

function listingXml(datasets: StubDataset[]): string {
  const contents = datasets
    .flatMap((d) => [
      `<Contents><Key>dandisets/${d.id}/draft/assets.jsonld</Key><Size>4096</Size></Contents>`,
      `<Contents><Key>dandisets/${d.id}/draft/dandiset.jsonld</Key><Size>1200</Size></Contents>`,
    ])
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

function assetsJson(paths: string[]): string {
  return JSON.stringify(
    paths.map((path, i) => ({
      path,
      contentSize: 1024 * (i + 1),
      encodingFormat: path.endsWith(".mp4") ? "video/mp4" : "application/x-nwb",
      contentUrl: [`${API}/assets/asset-${i}/download/`, path.endsWith(".mp4") ? CLIP_URL : `${BUCKET}/blobs/a/b/${i}`],
    })),
  );
}

/**
 * Serves the bucket's listing and manifests. The embargoed dataset is listed like any other but its
 * manifests answer 403, exactly as the real bucket does. Requests for blobs are left alone, so a
 * spec can route the video itself.
 */
async function stubBucket(page: Page): Promise<void> {
  const listed = [...PUBLIC_DATASETS, OWNED_DATASET];
  await page.route(`${BUCKET}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("list-type") === "2") {
      return route.fulfill({ status: 200, contentType: "application/xml", body: listingXml(listed) });
    }
    const dataset = listed.find((d) => url.pathname.startsWith(`/dandisets/${d.id}/`));
    if (!dataset) return route.continue();
    if (dataset.id === OWNED_DATASET.id) return route.fulfill({ status: 403, contentType: "application/xml", body: "<Error/>" });
    const json = (body: string) => route.fulfill({ status: 200, contentType: "application/json", body });
    if (url.pathname.endsWith("/dandiset.jsonld")) return json(JSON.stringify({ name: dataset.name }));
    if (url.pathname.endsWith("/assets.jsonld")) return json(assetsJson(dataset.paths));
    return route.continue();
  });
}

/** Signs the page in and stubs the API calls the browse pane makes against that session. */
async function stubSignedIn(page: Page): Promise<void> {
  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/users/me/")) return json({ username: "ada-lovelace", name: "Ada Lovelace" });
    if (url.includes("/dandisets/?user=me")) {
      return json({
        results: [
          { identifier: OWNED_DATASET.id, embargo_status: "EMBARGOED", draft_version: { name: OWNED_DATASET.name } },
          // Owned but already public, so the bucket already covers it and it is not listed twice.
          { identifier: "000265", embargo_status: "OPEN", draft_version: { name: "Mouse open field" } },
          { identifier: "000901", embargo_status: "EMBARGOED", draft_version: { name: "Somebody else's lab" } },
        ],
      });
    }
    if (url.includes(`/dandisets/${OWNED_DATASET.id}/users/`)) return json([{ username: "ada-lovelace" }]);
    // Returned by the listing but owned by somebody else — an admin's `?user=me` comes back
    // holding the whole archive's embargoed datasets, so the owner list is what settles it.
    if (url.includes("/dandisets/000901/users/")) return json([{ username: "grace-hopper" }]);
    if (url.includes(`/dandisets/${OWNED_DATASET.id}/versions/draft/assets/`)) {
      return json({ results: [{ asset_id: "held-1", path: OWNED_DATASET.paths[0], size: 4096 }], next: null });
    }
    return json({});
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "clip-extractor.settings.v1",
      JSON.stringify({ oauth: { accessToken: "test-token", expiresAt: Date.now() + 3_600_000 } }),
    );
    localStorage.setItem("clip-extractor.analytics-consent", "declined");
  });
}

test("browsing EMBER lists only the datasets that hold video, and says nothing once it has", async ({ page }) => {
  await stubBucket(page);
  await page.goto("/");

  await page.locator('#srcSeg button[data-src="browse"]').click();
  await expect(page.locator("#browsePane")).toBeVisible();
  await expect(page.locator("#dropzone")).toBeHidden();

  // EMBER's manifests are small enough to read wholesale, so every dataset is scanned for video up
  // front and the ones holding none drop out. The ephys-only dataset is one of those; the embargoed
  // one is in the bucket listing but unreadable, so signed out it counts as holding nothing either.
  const rows = page.locator("#browseDandisets .browse-item");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Mouse open field");
  await expect(rows.first()).toContainText("1 video");
  await expect(page.locator("#browseDandisets")).not.toContainText("Ephys only");
  await expect(page.locator("#browseDandisets")).not.toContainText("000900");
  // The list is the answer, so the status line has nothing left to add.
  await expect(page.locator("#browseStatus")).toHaveText("");
});

test("the filter matches a dataset by number, by title and by the files in it", async ({ page }) => {
  await stubBucket(page);
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();
  const rows = page.locator("#browseDandisets .browse-item");
  await expect(rows).toHaveCount(2);

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
  await stubBucket(page);
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

test("an archive too large to scan wholesale lists everything and reads a file list on demand", async ({ page }) => {
  // Manifests well past the sweep budget, so no dataset is scanned up front. Nothing is then known
  // about which hold video, so every one is listed — and a video-less one answers for itself.
  await page.route(`${BUCKET}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("list-type") === "2") {
      const contents = PUBLIC_DATASETS.flatMap((d) => [
        `<Contents><Key>dandisets/${d.id}/draft/assets.jsonld</Key><Size>${64 * 1024 * 1024}</Size></Contents>`,
        `<Contents><Key>dandisets/${d.id}/draft/dandiset.jsonld</Key><Size>1200</Size></Contents>`,
      ]).join("");
      const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>b</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
      return route.fulfill({ status: 200, contentType: "application/xml", body });
    }
    const dataset = PUBLIC_DATASETS.find((d) => url.pathname.startsWith(`/dandisets/${d.id}/`));
    if (!dataset) return route.continue();
    const json = (body: string) => route.fulfill({ status: 200, contentType: "application/json", body });
    if (url.pathname.endsWith("/dandiset.jsonld")) return json(JSON.stringify({ name: dataset.name }));
    if (url.pathname.endsWith("/assets.jsonld")) return json(assetsJson(dataset.paths));
    return route.continue();
  });
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();

  const rows = page.locator("#browseDandisets .browse-item");
  await expect(rows).toHaveCount(3);
  // Unscanned, so a row reports what opening it would cost rather than a video count.
  await expect(rows.first()).toContainText("64.00 MB");

  await page.locator('#browseDandisets .browse-item:has-text("000005")').click();
  await expect(page.locator("#browseVideos .browse-empty")).toContainText("no video files");
});

test("signing in adds the embargoed datasets you own, marked as such", async ({ page }) => {
  await stubBucket(page);
  await stubSignedIn(page);
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();

  // The embargoed dataset is unreadable in the bucket, so it is only seen at all because the API
  // listed it — and it now counts among the datasets that hold video.
  const rows = page.locator("#browseDandisets .browse-item");
  await expect(rows).toHaveCount(3);
  const owned = page.locator('#browseDandisets .browse-item:has-text("000900")');
  await expect(owned).toContainText("Incoming: Test Lab");
  await expect(owned.locator(".badge")).toHaveText("embargoed");
  // Owned but already public: listed once, from the bucket, without an embargoed badge.
  await expect(page.locator('#browseDandisets .browse-item:has-text("000265") .badge')).toHaveCount(0);
  // Returned by the archive's listing but owned by somebody else, so it is not offered — an admin
  // gets every embargoed dataset back from `?user=me`, and only the owner list settles it.
  await expect(page.locator("#browseDandisets")).not.toContainText("000901");
});

// Opening an embargoed video asks the archive for a short-lived signed link and streams from
// wherever that redirect lands. The redirect itself is not exercised here: Playwright's request
// interception cannot fulfil a *cross-origin* redirect (a fulfilled 302 to another host resets the
// connection, though the same fulfilment works same-origin), so what a real archive's redirect
// resolves to is covered by the unit tests over resolveEmbargoedStreamUrl instead. What this spec
// holds onto is the pane's own behaviour either side of that call.
test("an embargoed dataset lists its videos through the API", async ({ page }) => {
  await stubBucket(page);
  await stubSignedIn(page);
  await page.goto("/");

  await page.locator('#srcSeg button[data-src="browse"]').click();
  await page.locator('#browseDandisets .browse-item:has-text("000900")').click();

  await expect(page.locator("#browseVideoHeading")).toHaveText("Videos in 000900");
  const videos = page.locator("#browseVideos .browse-item");
  await expect(videos).toHaveCount(1);
  await expect(videos.first()).toContainText("sub-A/held.mp4");
  await expect(videos.first()).toContainText("4.0 KB");
});

test("a video in a container that cannot stream is marked in the listing and refused when it is picked", async ({ page }) => {
  // The archive's own manifest reports the size, so the pane knows what opening this would cost
  // before anything is asked of the bucket.
  const dataset: StubDataset = { id: "000700", name: "Long recordings", paths: ["sub-1/session.avi"] };
  await page.route(`${BUCKET}/**`, (route) => {
    const url = new URL(route.request().url());
    const json = (body: string) => route.fulfill({ status: 200, contentType: "application/json", body });
    if (url.searchParams.get("list-type") === "2") {
      return route.fulfill({ status: 200, contentType: "application/xml", body: listingXml([dataset]) });
    }
    if (url.pathname.endsWith("/dandiset.jsonld")) return json(JSON.stringify({ name: dataset.name }));
    if (url.pathname.endsWith("/assets.jsonld")) {
      const asset = {
        path: dataset.paths[0],
        contentSize: 3 * 1024 ** 3,
        contentUrl: [`${API}/assets/asset-0/download/`, `${BUCKET}/blobs/a/b/0`],
      };
      return json(JSON.stringify([asset]));
    }
    return route.continue();
  });
  await page.goto("/");

  await page.locator('#srcSeg button[data-src="browse"]').click();
  await page.locator("#browseDandisets .browse-item").first().click();
  const videos = page.locator("#browseVideos .browse-item");
  await expect(videos.first()).toContainText("3.00 GB");
  await expect(videos.first()).toContainText("no streaming");

  await videos.first().click();
  const lines = page.locator("#browseStatus p.message-line");
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveText("session.avi cannot be opened.");
  await expect(lines.nth(1)).toContainText("1.00 GB");
  await expect(lines.nth(2).locator("a")).toHaveText("Encoding Helper");
  await expect(page.locator("#view")).toBeHidden();
});

test("a second refusal replaces the first, rather than being read beside it", async ({ page }) => {
  // Two videos neither of which will open, picked one after the other. The first fails inside the
  // load, the second is refused before it starts, and before this they answered on different
  // surfaces — leaving the stage still holding the first while the pane reported the second.
  const dataset: StubDataset = { id: "000700", name: "Long recordings", paths: ["sub-1/first.mkv", "sub-1/second.avi"] };
  await page.route(`${BUCKET}/**`, (route) => {
    const url = new URL(route.request().url());
    const json = (body: string) => route.fulfill({ status: 200, contentType: "application/json", body });
    if (url.searchParams.get("list-type") === "2") {
      return route.fulfill({ status: 200, contentType: "application/xml", body: listingXml([dataset]) });
    }
    if (url.pathname.endsWith("/dandiset.jsonld")) return json(JSON.stringify({ name: dataset.name }));
    if (url.pathname.endsWith("/assets.jsonld")) {
      // The `.mkv` is small enough to be attempted, and the bytes behind it are not there, so it
      // fails inside the load. The `.avi` is refused before a byte of it is asked for.
      return json(
        JSON.stringify([
          { path: dataset.paths[0], contentSize: 4096, contentUrl: [`${API}/assets/a-0/download/`, `${BUCKET}/blobs/a/b/0`] },
          { path: dataset.paths[1], contentSize: 3 * 1024 ** 3, contentUrl: [`${API}/assets/a-1/download/`, `${BUCKET}/blobs/a/b/1`] },
        ]),
      );
    }
    if (url.pathname.startsWith("/blobs/")) return route.fulfill({ status: 404, contentType: "text/plain", body: "gone" });
    return route.continue();
  });
  await page.goto("/");

  await page.locator('#srcSeg button[data-src="browse"]').click();
  // The sweep clears the status line when it finishes, so it is left to finish before anything is
  // written there to be read.
  await expect(page.locator("#browseStatus")).toHaveText("");
  await page.locator("#browseDandisets .browse-item").first().click();
  const videos = page.locator("#browseVideos .browse-item");

  await videos.first().click();
  await expect(page.locator("#browseStatus")).toContainText("first.mkv cannot be opened.");
  // The stage keeps its invitation: the pane is where this video was asked for, so it is where the
  // answer goes.
  await expect(page.locator("#emptyStage")).toHaveText(/No video loaded/);

  await videos.nth(1).click();
  await expect(page.locator("#browseStatus")).toContainText("second.avi cannot be opened.");
  await expect(page.locator("#browseStatus")).not.toContainText("first.mkv");
  await expect(page.locator("#emptyStage")).toHaveText(/No video loaded/);
  // One refusal on the page, not two.
  await expect(page.locator("p.message-line", { hasText: "cannot be opened efficiently through streaming" })).toHaveCount(1);
});

test("an embargoed video the archive will not hand out says so, and leaves the player alone", async ({ page }) => {
  await stubBucket(page);
  await stubSignedIn(page);
  await page.route(`${API}/assets/held-1/download/**`, (route) => route.fulfill({ status: 403, contentType: "text/plain", body: "" }));
  await page.goto("/");

  await page.locator('#srcSeg button[data-src="browse"]').click();
  await page.locator('#browseDandisets .browse-item:has-text("000900")').click();
  await page.locator("#browseVideos .browse-item").first().click();

  await expect(page.locator("#browseStatus")).toContainText("held.mp4 cannot be opened.");
  await expect(page.locator("#view")).toBeHidden();
  await expect(page.locator("#emptyStage")).toBeVisible();
});

test("an unreachable bucket is reported instead of an empty archive", async ({ page }) => {
  await page.route(`${BUCKET}/**`, (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "" }));
  await page.goto("/");
  await page.locator('#srcSeg button[data-src="browse"]').click();
  await expect(page.locator("#browseStatus")).toContainText("Could not read the EMBER archive");
});
