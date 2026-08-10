import { test, expect } from "@playwright/test";
import { stubArchive, loadRecordedVideo } from "./helpers";

// Drives a real upload against a stubbed archive, to pin down the asset paths every file actually
// lands at: the directory's date/time/type entities, the extract's own entities, the sidecar that
// mirrors them, and the original video's untouched name. A single frame is used as the selection
// because that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

test("an upload registers the extract, the original and a matching provenance sidecar", async ({ page }) => {
  const { registered, uploaded } = await stubArchive(page);

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
  await page.locator("#selectionDescription").fill("Frame 5 is where the two tracks swap identities.");
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

  // The sidecar that actually went up carries the description written for this selection, and names
  // the dataset it was uploaded to.
  const directory = [...directories][0];
  const sidecar = uploaded.map((part) => part.toString()).find((body) => body.startsWith("{"));
  const provenance = JSON.parse(sidecar!) as Record<string, unknown>;
  expect(provenance.description).toBe("Frame 5 is where the two tracks swap identities.");
  expect(provenance.destination).toEqual({
    api: "https://api-dandi.emberarchive.org/api",
    dandiset_id: "000123",
    directory,
  });
  expect(provenance.uploaded_by).toEqual({ username: "ada-lovelace", name: "Ada Lovelace" });

  // The completion link opens the archive's file browser at this upload's own directory.
  await expect(status.locator("a")).toHaveText("click here to view and share");
  await expect(status.locator("a")).toHaveAttribute(
    "href",
    `https://dandi.emberarchive.org/dandiset/000123/draft/files?location=${encodeURIComponent(directory)}`,
  );
  await expect(status.locator("a")).toHaveAttribute("target", "_blank");
});

test("the completion link survives a look at the other pane, and retires with the selection", async ({ page }) => {
  await stubArchive(page);
  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
  await page.locator("#selectionDescription").fill("Worth sharing with the lab.");
  await page.locator("#btnUpload").click();
  const status = page.locator("#uploadStatus");
  await expect(status).toContainText("Upload complete", { timeout: 60_000 });

  // Looking at what Save would have done, then coming back, is not a reason to lose the link to
  // where the upload landed.
  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(status).toContainText("Upload complete");
  await expect(status.locator("a")).toHaveText("click here to view and share");

  // Moving to another frame does retire it: it named where a different selection went.
  await page.locator("#frameSlider").fill("9");
  await expect(status).not.toContainText("Upload complete");
});
