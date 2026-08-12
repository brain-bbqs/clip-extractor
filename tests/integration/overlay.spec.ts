import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, seekTo, stubArchive, stubH5Wasm } from "./helpers";

// A .slp loaded alongside the video adds two more assets to an upload: the annotations file itself
// (with the "include the original content" toggle) and a rendered overlay version of the selection
// (regardless of that toggle). Frame mode is used so no ffmpeg.wasm — and so no CDN — is needed.
const SLP_FIXTURE = fileURLToPath(new URL("../fixtures/mice_new.tracked.slp", import.meta.url));

test("a loaded .slp adds the annotations file and a rendered overlay to the upload", async ({ page }) => {
  const { registered } = await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "mice_new.webm");
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  // The badge only appears once the .slp has parsed, which is also when it becomes uploadable.
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Both mice are tracked cleanly through this frame.");
  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 120_000 });

  // The video and the .slp are the content this app was handed, so they sit together under
  // `original/`; the extract, its overlay and the sidecar are what it produced.
  const directory = registered[0].slice(0, registered[0].lastIndexOf("/"));
  expect(registered.map((path) => path.slice(directory.length + 1))).toEqual([
    "name-mice+new_index-5_type-frame_image.png",
    "name-mice+new_index-5_type-frame_overlay.png",
    "original/mice_new.webm",
    "original/mice_new.tracked.slp",
    "name-mice+new_index-5_type-frame_provenance.json",
  ]);
});

test("the overlay is uploaded even when the original content is excluded", async ({ page }) => {
  const { registered } = await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice_new.webm");
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("The skeleton drifts off the second mouse here.");
  await page.locator("#uploadOriginal").uncheck();
  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 120_000 });

  // No source video and no .slp, but the overlay is still there.
  expect(registered.map((path) => path.split("/").pop())).toEqual([
    "name-mice+new_index-5_type-frame_image.png",
    "name-mice+new_index-5_type-frame_overlay.png",
    "name-mice+new_index-5_type-frame_provenance.json",
  ]);
});
