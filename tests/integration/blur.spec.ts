import { test, expect, type Page } from "@playwright/test";
import { loadRecordedVideo, seekTo, stubArchive } from "./helpers";

// The human-subjects gate and the blur tool it brings out: the warning bbqs-uploader raises for a
// dataset flagged as holding recordings of people, the Upload button held until it is confirmed, and
// the areas blurred out of everything the extraction writes. A single frame is used as the
// selection throughout because that path needs no ffmpeg.wasm (and so no CDN) to produce a real
// file, while going through the same canvas the blur is painted onto.

const banner = "#humanSubjectsBanner";
const rings = "#blurLayer .blur-handle";

/** Places a blur area at a fraction of the way across the picture. The click is in display pixels,
 * which the page maps back onto the 320x240 source the recorder produced. */
async function placeBlurArea(page: Page, fractionX: number, fractionY: number): Promise<void> {
  await page.locator("#blurAddBtn").click();
  const box = (await page.locator("#view").boundingBox())!;
  await page.locator("#view").click({ position: { x: box.width * fractionX, y: box.height * fractionY } });
}

test("an unflagged dataset raises no warning and offers no blur tool", async ({ page }) => {
  await stubArchive(page);
  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice.webm");

  await expect(page.locator(banner)).toBeHidden();
  await expect(page.locator("#blurTools")).toBeHidden();
});

test("a flagged dataset warns, holds the upload until it is confirmed, and offers the blur tool", async ({ page }) => {
  await stubArchive(page, { humanSubjects: true });
  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Frame 5, with the participant's face covered.");

  await expect(page.locator(banner)).toContainText("HUMAN SUBJECTS");
  await expect(page.locator("#humanSubjectsUnconfirmed")).toBeVisible();
  await expect(page.locator("#blurTools")).toBeVisible();
  // Everything else about the selection is ready, so the warning is the only thing in the way.
  await expect(page.locator("#btnUpload")).toBeDisabled();
  await expect(page.locator("#uploadStatus")).toContainText("Confirm the human-subjects notice");

  await page.locator("#humanSubjectsConfirmBtn").click();
  await expect(page.locator("#humanSubjectsUnconfirmed")).toBeHidden();
  await expect(page.locator("#humanSubjectsConfirmed")).toBeVisible();
  await expect(page.locator("#btnUpload")).toBeEnabled();

  // The warning is about a destination, so saving to a computer instead has nothing to confirm.
  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await expect(page.locator(banner)).toBeHidden();
  await expect(page.locator("#blurTools")).toBeHidden();
});

test("blur areas are placed, resized and removed on the picture", async ({ page }) => {
  await stubArchive(page, { humanSubjects: true });
  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice.webm");

  // A tenth of the 320x240 recording's shorter side.
  await expect(page.locator("#blurRadiusValue")).toHaveValue("24");
  await placeBlurArea(page, 0.5, 0.5);
  await expect(page.locator(rings)).toHaveCount(1);
  await expect(page.locator(rings)).toHaveAttribute("aria-label", "Blur area 1 of 1, radius 24 pixels");

  // The radius controls act on the selected area, and the two views of it stay in step.
  await page.locator("#blurRadiusRange").fill("60");
  await expect(page.locator("#blurRadiusValue")).toHaveValue("60");
  await expect(page.locator(rings)).toHaveAttribute("aria-label", "Blur area 1 of 1, radius 60 pixels");

  await placeBlurArea(page, 0.25, 0.25);
  await expect(page.locator(rings)).toHaveCount(2);

  await page.locator("#blurRemoveBtn").click();
  await expect(page.locator(rings)).toHaveCount(1);
  await page.locator("#blurClearBtn").click();
  await expect(page.locator(rings)).toHaveCount(0);
  // With nothing blurred and the tool still offered by the flagged dataset, it stays on screen.
  await expect(page.locator("#blurTools")).toBeVisible();
});

test("a blurred selection is uploaded without the original, and says what it hid", async ({ page }) => {
  const { registered, uploaded } = await stubArchive(page, { humanSubjects: true });
  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
  await loadRecordedVideo(page, "mice.webm");
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Frame 5, with the participant's face covered.");
  await page.locator("#humanSubjectsConfirmBtn").click();
  await expect(page.locator("#uploadOriginal")).toBeChecked();

  await placeBlurArea(page, 0.5, 0.5);
  // The original still holds the pixels that were just covered, so it stops travelling along.
  await expect(page.locator("#uploadOriginal")).not.toBeChecked();
  await expect(page.locator("#uploadOriginal")).toBeDisabled();
  await expect(page.locator("#blurOriginalNote")).toBeVisible();

  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 60_000 });

  // The frame and its sidecar, and no original beside them.
  expect(registered).toHaveLength(2);
  expect(registered.some((path) => path.includes("/original/"))).toBe(false);

  const sidecar = uploaded.map((part) => part.toString()).find((body) => body.startsWith("{"));
  const provenance = JSON.parse(sidecar!) as {
    blur: { method: string; sigma: number; regions: { x: number; y: number; radius: number }[] };
    source_video: { uploaded: boolean };
    extracted: { encoding: string };
  };
  expect(provenance.blur.method).toBe("gaussian");
  expect(provenance.blur.sigma).toBe(8);
  expect(provenance.blur.regions).toHaveLength(1);
  // Placed at the middle of a 320x240 recording, to within the rounding of a display-pixel click.
  expect(provenance.blur.regions[0].radius).toBe(24);
  expect(Math.abs(provenance.blur.regions[0].x - 160)).toBeLessThanOrEqual(2);
  expect(Math.abs(provenance.blur.regions[0].y - 120)).toBeLessThanOrEqual(2);
  expect(provenance.source_video.uploaded).toBe(false);
  expect(provenance.extracted.encoding).toContain("1 blurred region, gaussian sigma 8");
});
