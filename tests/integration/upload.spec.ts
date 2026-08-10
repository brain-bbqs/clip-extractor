import { test, expect } from "@playwright/test";
import { stubArchive, loadRecordedVideo } from "./helpers";

// Drives a real upload against a stubbed archive, to pin down the asset paths every file actually
// lands at: the directory's date/time/type entities, the extract's own entities, the sidecar that
// mirrors them, and the original video's untouched name. A single frame is used as the selection
// because that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

test("an upload registers the extract, the original and a matching provenance sidecar", async ({ page }) => {
  const registered = await stubArchive(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
  await expect(page.locator("#uploadOriginal")).toBeChecked();
  await expect(page.locator("#btnUpload")).toBeEnabled();

  await page.locator("#btnUpload").click();
  const status = page.locator("#uploadStatus");
  await expect(status).toContainText("Upload complete", { timeout: 60_000 });

  expect(registered).toHaveLength(3);
  // One timestamped directory for the whole upload, tagged with what it holds.
  const directories = new Set(registered.map((path) => path.slice(0, path.lastIndexOf("/"))));
  expect(directories.size).toBe(1);
  expect([...directories][0]).toMatch(/^sourcedata\/raw\/clip-extractor\/date-\d{8}_time-\d{6}_type-frame$/);
  // The extract goes up first, then the original, then the sidecar naming both.
  expect(registered.map((path) => path.split("/").pop())).toEqual([
    "name-file+example+480+Copy_index-5_type-frame_image.png",
    "file_example_480-Copy.webm",
    "name-file+example+480+Copy_index-5_type-frame_provenance.json",
  ]);

  // The completion link opens the archive's file browser at this upload's own directory.
  const directory = [...directories][0];
  await expect(status.locator("a")).toHaveText("click here to view and share");
  await expect(status.locator("a")).toHaveAttribute(
    "href",
    `https://dandi.emberarchive.org/dandiset/000123/draft/files?location=${encodeURIComponent(directory)}`,
  );
  await expect(status.locator("a")).toHaveAttribute("target", "_blank");
});
