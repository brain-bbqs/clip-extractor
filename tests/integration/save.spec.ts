import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, seekTo } from "./helpers";

// Save writes the same files an upload would have registered, packed into one gzipped tar — so this
// drives a real save and unpacks what lands on disk. A single frame is used as the selection because
// that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

const BLOCK = 512;

// No archive path names a locally dropped video, so its subject entity falls back to `sub-unknown`
// (see lib/bidsPath.ts's behEntities), and the recording entity is stamped from Save's own instant —
// only its shape (17 digits) is pinned down here.
const RECORDING = "\\d{17}";

/** Walks the 512-byte headers of a tar, the way `tar tf` lists it. */
function listTar(gzipped: Buffer): { path: string; size: number; text: string }[] {
  const tar = gunzipSync(gzipped);
  const read = (offset: number, start: number, length: number) => {
    const raw = tar.subarray(offset + start, offset + start + length);
    const end = raw.findIndex((b) => b === 0 || b === 0x20);
    return raw.subarray(0, end === -1 ? raw.length : end).toString();
  };
  const entries: { path: string; size: number; text: string }[] = [];
  for (let offset = 0; offset + BLOCK <= tar.length && tar[offset] !== 0;) {
    const prefix = read(offset, 345, 155);
    const name = read(offset, 0, 100);
    const size = parseInt(read(offset, 124, 12), 8);
    offset += BLOCK;
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      size,
      text: tar.subarray(offset, offset + size).toString(),
    });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

test("a save writes a bundle holding the extract, the original, their sidecar and all three dataset_description.json files", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/");
  // Signed out, Save is the side that leads.
  await expect(page.locator("#downloadPane")).toBeVisible();

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  // Nothing is saved until the selection has been described.
  await expect(page.locator("#btnDownload")).toBeDisabled();
  await expect(page.locator("#downloadStatus")).toContainText("Describe the frame");
  await page.locator("#selectionDescription").fill("The mouse leaves frame here — the tracker keeps a stale track.");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  // The button names the bundle before it is written.
  await expect(page.locator("#downloadPreviewName")).toHaveText(
    new RegExp(`^sub-unknown_recording-${RECORDING}_desc-frame_bundle\\.tar\\.gz$`),
  );

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^sub-unknown_recording-${RECORDING}_desc-frame_bundle\\.tar\\.gz$`));
  await expect(page.locator("#downloadStatus")).toContainText("Saved");

  const entries = listTar(readFileSync((await download.path())!));
  // The same files, in the same order, an upload would have written: the extract under
  // `derivatives/clip-extractor/`, the original (and its own technical sidecar) under `sourcedata/`
  // (both mirroring the same fallback subject), the extract's own sidecar, then both
  // `dataset_description.json` files.
  const derivativesDir = entries[0].path.slice(0, entries[0].path.lastIndexOf("/"));
  expect(derivativesDir).toBe("derivatives/clip-extractor/sub-unknown/beh");
  const recording = entries[0].path.match(/recording-(\d+)/)![1];
  expect(entries.map((e) => e.path)).toEqual([
    `${derivativesDir}/sub-unknown_recording-${recording}_image.png`,
    "sourcedata/rawbids/sub-unknown/beh/file_example_480-Copy.webm",
    "sourcedata/rawbids/sub-unknown/beh/file_example_480-Copy.json",
    `${derivativesDir}/sub-unknown_recording-${recording}_image.json`,
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
    "sourcedata/rawbids/dataset_description.json",
  ]);
  expect(entries[0].size).toBeGreaterThan(0);

  const sidecar = JSON.parse(entries[3].text) as Record<string, unknown>;
  expect(sidecar.Description).toBe("The mouse leaves frame here — the tracker keeps a stale track.");
  const provenance = sidecar["clip-extractor"] as Record<string, unknown>;
  expect(provenance.format).toBe("clip-extractor-provenance/v1");
  // Nothing was uploaded, so there is no archive to name — only the directory inside the bundle.
  expect(provenance.destination).toEqual({ api: null, dandiset_id: null, directory: derivativesDir });
  expect(provenance.uploaded_by).toBeNull();
  // The original rode along, checksummed exactly as an upload would have registered it.
  const source = provenance.source_video as Record<string, unknown>;
  expect(source.uploaded).toBe(true);
  expect(source.asset_path).toBe("sourcedata/rawbids/sub-unknown/beh/file_example_480-Copy.webm");
  expect((source.checksum as { value: string }).value).toMatch(/^[0-9a-f]{32}-\d+$/);

  // The original's own sidecar carries its real technical properties, not a copy of the extract's.
  const originalSidecar = JSON.parse(entries[2].text) as Record<string, unknown>;
  expect(originalSidecar.Description).toBe("The source video this selection was clipped from.");
  expect(originalSidecar.ImageWidth).toBe(320);
  expect(originalSidecar.ImageHeight).toBe(240);
  expect(originalSidecar.GeneratedBy).toBeUndefined();

  const rootDescription = JSON.parse(entries[4].text) as Record<string, unknown>;
  // "study": this root organizes sourcedata/rawbids/ (raw) and derivatives/ (derived) together.
  expect(rootDescription.DatasetType).toBe("study");
  expect(rootDescription.Name).toMatch(/^Frame extracted using the Clip Extractor on \d{4}-\d{2}-\d{2}T/);
  const generatedBy = rootDescription.GeneratedBy as { Name: string; SourceVideo: { filename: string } }[];
  expect(generatedBy[0].Name).toBe("clip-extractor");
  expect(generatedBy[0].SourceVideo.filename).toBe("file_example_480 - Copy.webm");
  const derivativesDescription = JSON.parse(entries[5].text) as Record<string, unknown>;
  expect(derivativesDescription.DatasetType).toBe("derivative");
  // The same study name, with a suffix, so the three read as one related set.
  expect(derivativesDescription.Name).toBe(`${rootDescription.Name} (Extracted)`);
  // No real URL for a locally dropped file, but its name and checksum still are.
  expect(derivativesDescription.SourceDatasets).toEqual([
    { Filename: "file_example_480 - Copy.webm", Checksum: { algorithm: "dandi:dandi-etag", value: expect.any(String) } },
  ]);
  // sourcedata/rawbids's own — DatasetType: "raw" too, so that subtree validates independently.
  const sourcedataDescription = JSON.parse(entries[6].text) as Record<string, unknown>;
  expect(sourcedataDescription.DatasetType).toBe("raw");
  expect(sourcedataDescription.Name).toBe(`${rootDescription.Name} (Original)`);
});

test("leaving the original out saves the extract and its sidecar alone, plus all three dataset_description.json files", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/");

  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#selectionDescription").fill("A clean frame, kept as a reference.");
  await page.locator("#uploadOriginal").uncheck();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  const entries = listTar(readFileSync((await download.path())!));
  expect(entries.map((e) => e.path)).toEqual([
    entries[0].path,
    entries[1].path,
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
    "sourcedata/rawbids/dataset_description.json",
  ]);
  expect(entries[0].path).toMatch(
    new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/sub-unknown_recording-${RECORDING}_image\\.png$`),
  );
  expect(entries[1].path).toMatch(
    new RegExp(`^derivatives/clip-extractor/sub-unknown/beh/sub-unknown_recording-${RECORDING}_image\\.json$`),
  );

  const sidecar = JSON.parse(entries[1].text) as Record<string, unknown>;
  // Left out of the bundle, but still named and checksummed: that is what ties the frame to it.
  const provenance = sidecar["clip-extractor"] as Record<string, unknown>;
  const source = provenance.source_video as Record<string, unknown>;
  expect(source.uploaded).toBe(false);
  expect(source.asset_path).toBeNull();
  expect(source.filename).toBe("mice.webm");
  expect((source.checksum as { value: string }).value).toMatch(/^[0-9a-f]{32}-\d+$/);
  expect(sidecar.Description).toBe("A clean frame, kept as a reference.");
});

test("a known subject and session get date-/time- entities in derivatives, and no disambiguator at all in sourcedata", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  // `?test&mock_video&mock_sub=`/`&mock_ses=` (see lib/testInjection.ts) makes the mock video look,
  // to lib/bidsPath.ts's behEntities, as if it were opened from the archive at sub-01/ses-02/…
  await page.goto("/?test&mock_video&mock_sub=01&mock_ses=02");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#selectionDescription").fill("A known subject, for once.");

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  const entries = listTar(readFileSync((await download.path())!));
  expect(entries.map((e) => e.path)).toEqual([
    expect.stringMatching(/^derivatives\/clip-extractor\/sub-01\/ses-02\/beh\/sub-01_ses-02_date-\d{8}_time-\d{6}_image\.png$/),
    "sourcedata/rawbids/sub-01/ses-02/beh/test-injection-mock-video.webm",
    "sourcedata/rawbids/sub-01/ses-02/beh/test-injection-mock-video.json",
    expect.stringMatching(/^derivatives\/clip-extractor\/sub-01\/ses-02\/beh\/sub-01_ses-02_date-\d{8}_time-\d{6}_image\.json$/),
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
    "sourcedata/rawbids/dataset_description.json",
  ]);
});

test("mock_ready lands on a saveable state with no manual selection or description", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  // `?test&mock_video&mock_ready` (see lib/testInjection.ts) picks a frame and types a description on
  // its own — the two things Save/Upload gate on — so this link alone previews real Save output.
  await page.goto("/?test&mock_video&mock_ready");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  expect(download.suggestedFilename()).toMatch(/^sub-unknown_recording-\d{17}_desc-frame_bundle\.tar\.gz$/);
});
