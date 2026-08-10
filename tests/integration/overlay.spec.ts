import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { stubArchive, stubH5Wasm, loadRecordedVideo } from "./helpers";

// A .slp loaded alongside the video adds two more assets to an upload: the annotations file itself
// (with the "include the original content" toggle) and a rendered overlay version of the selection
// (regardless of that toggle). Frame mode is used so no ffmpeg.wasm — and so no CDN — is needed.
const SLP_FIXTURE = fileURLToPath(new URL("../fixtures/mice_new.tracked.slp", import.meta.url));

test("a loaded .slp adds the annotations file and a rendered overlay to the upload", async ({ page }) => {
  const registered = await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "mice_new.webm");
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  // The badge only appears once the .slp has parsed, which is also when it becomes uploadable.
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 120_000 });

  expect(registered.map((path) => path.split("/").pop())).toEqual([
    "name-mice+new_index-5_type-frame_image.png",
    "name-mice+new_index-5_type-frame_overlay.png",
    "mice_new.webm",
    "mice_new.tracked.slp",
    "name-mice+new_index-5_type-frame_provenance.json",
  ]);
});

test("the overlay is uploaded even when the original content is excluded", async ({ page }) => {
  const registered = await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice_new.webm");
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
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
