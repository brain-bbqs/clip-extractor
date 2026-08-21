import { test, expect, type Page } from "@playwright/test";
import { seekTo, stubArchive } from "./helpers";

// The human-subjects gate and the blur tool it brings out: the warning bbqs-uploader raises for a
// dataset flagged as holding recordings of people, the Upload button held until it is confirmed, and
// the areas blurred out of everything the extraction writes. A single frame is used as the
// selection throughout because that path needs no ffmpeg.wasm (and so no CDN) to produce a real
// file, while going through the same canvas the blur is painted onto.
//
// The gate and the tool only care that the *selected dataset* is flagged, not that anything real is
// behind it — so every test except the one that actually uploads (and so has to verify what really
// landed on the stub archive) reaches its state through `?test&mock_video&num_datasets=1[&human_subjects]`
// instead of a stubbed archive and a synthesized-in-Playwright video. The fake destination is
// `FAKE_DANDISET_ID_BASE` from lib/testInjection.ts, "9900001".

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
  await page.goto("/?test&mock_video&num_datasets=1");
  await expect(page.locator("#dandisetSingleText")).toContainText("9900001");
  await expect(page.locator("#view")).toBeVisible();

  await expect(page.locator(banner)).toBeHidden();
  await expect(page.locator("#blurTools")).toBeHidden();
});

test("a flagged dataset warns, holds the upload until it is confirmed, and offers the blur tool", async ({ page }) => {
  await page.goto("/?test&mock_video&num_datasets=1&human_subjects");
  await expect(page.locator("#dandisetSingleText")).toContainText("9900001");
  await expect(page.locator("#view")).toBeVisible();
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
  await page.goto("/?test&mock_video&num_datasets=1&human_subjects");
  await expect(page.locator("#dandisetSingleText")).toContainText("9900001");
  await expect(page.locator("#view")).toBeVisible();

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

test("a blurred selection is uploaded without the original", async ({ page }) => {
  // The one test in this file that actually uploads, so it needs the real stubbed archive to verify
  // what landed on it — `?test&mock_video` only replaces the video-loading half of the setup.
  const { registered } = await stubArchive(page, { humanSubjects: true });
  await page.goto("/?test&mock_video");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");
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

  // The frame, its sidecar, and all three dataset_description.json files — no actual sourcedata
  // content beside them (sourcedata/rawbids's own description is still written, same as the other
  // two: all three are dataset-level, not tied to what any one delivery actually put underneath).
  expect(registered).toHaveLength(5);
  expect(registered.some((path) => path.startsWith("sourcedata/") && !path.endsWith("dataset_description.json"))).toBe(false);
});
