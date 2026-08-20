import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, seekTo, stubArchive, stubH5Wasm, SLP_CLIP_FRAMES } from "./helpers";

// A .slp loaded alongside the video adds two more assets to an upload: the annotations file itself
// (with the "include the original content" toggle) and a rendered overlay version of the selection,
// with its own sidecar (regardless of that toggle). Frame mode is used so no ffmpeg.wasm — and so no
// CDN — is needed.
const SLP_FIXTURE = fileURLToPath(new URL("../fixtures/mice_new.tracked.slp", import.meta.url));

// No archive path names a locally dropped video, so its subject entity falls back to `sub-unknown`
// (see lib/bidsPath.ts's behEntities), and the recording entity is stamped from the upload's own
// instant — read back from the first registered path rather than pinned down here.
const DERIVATIVES_DIR = "derivatives/clip-extractor/sub-unknown/beh";

test("a loaded .slp adds the annotations file and a rendered overlay (with its own sidecar) to the upload", async ({ page }) => {
  const { registered } = await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "mice_new.webm", SLP_CLIP_FRAMES);
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  // The badge only appears once the .slp has parsed, which is also when it becomes uploadable.
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Both mice are tracked cleanly through this frame.");
  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 120_000 });

  // The video and the .slp are the content this app was handed, so they sit under `sourcedata/`; the
  // extract, its overlay and both their sidecars are what it produced, under `derivatives/`.
  const recording = registered[0].match(/recording-(\d+)/)![1];
  expect(registered).toEqual([
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_image.png`,
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_desc-overlay_image.png`,
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_desc-overlay_image.json`,
    "sourcedata/sub-unknown/beh/mice_new.webm",
    "sourcedata/sub-unknown/beh/mice_new.tracked.slp",
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_image.json`,
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
  ]);
});

test("the overlay is uploaded even when the original content is excluded", async ({ page }) => {
  const { registered } = await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice_new.webm", SLP_CLIP_FRAMES);
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("The skeleton drifts off the second mouse here.");
  await page.locator("#uploadOriginal").uncheck();
  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 120_000 });

  // No source video and no .slp, but the overlay and both sidecars are still there.
  const recording = registered[0].match(/recording-(\d+)/)![1];
  expect(registered).toEqual([
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_image.png`,
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_desc-overlay_image.png`,
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_desc-overlay_image.json`,
    `${DERIVATIVES_DIR}/sub-unknown_recording-${recording}_image.json`,
    "dataset_description.json",
    "derivatives/clip-extractor/dataset_description.json",
  ]);
});
