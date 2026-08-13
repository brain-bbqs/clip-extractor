import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, stubArchive, stubH5Wasm, SLP_CLIP_FRAMES } from "./helpers";

// An ndx-pose `.nwb` goes through the same card as a `.slp`, but it says less about the video it
// was labeled against: the predictions flavor records only a filename. What stands in for the frame
// count is the pose series itself — one sample per video frame — which the app measures off the
// data array (see src/lib/nwb.ts).
//
// Both fixtures name the clip these specs synthesize, so the recorded name is never what the card
// reacts to here; the series length is.
const COVERS_PART = fileURLToPath(new URL("../fixtures/mice_new.pose.nwb", import.meta.url));
const TOO_LONG = fileURLToPath(new URL("../fixtures/mice_long.pose.nwb", import.meta.url));

test("an ndx-pose .nwb loads and draws, noting how much of the video it covers", async ({ page }) => {
  await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await loadRecordedVideo(page, "mice_new.webm", SLP_CLIP_FRAMES);
  await page.locator("#slpFile").setInputFiles(COVERS_PART);

  // 30 samples, one per frame, so 30 labeled frames come out of it.
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");
  await expect(page.locator("#slpError")).toBeHidden();
  // Fewer samples than the clip has frames is not grounds to refuse — pose for part of a video is a
  // real thing — but it is worth saying out loud. The clip's exact length is up to the recorder.
  await expect(page.locator("#slpWarningList li")).toHaveText(/^The \.nwb holds 30 pose samples for a video of \d+ frames\.$/);
  await expect(page.locator("#showPose")).toBeVisible();
});

test("an .nwb sampled over a longer recording is refused", async ({ page }) => {
  await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await loadRecordedVideo(page, "mice_new.webm", SLP_CLIP_FRAMES);
  await page.locator("#slpFile").setInputFiles(TOO_LONG);

  await expect(page.locator("#slpError")).toBeVisible();
  await expect(page.locator("#slpErrorTitle")).toHaveText('"mice_long.pose.nwb" does not match "mice_new.webm".');
  // Two ways of saying the same thing, and the file records neither a frame count nor a frame size
  // to say it the way a `.slp` would: its labels run past the end of the clip, and it holds more
  // samples than the clip has frames. Both name the .nwb rather than a .slp.
  const problems = page.locator("#slpErrorList li");
  await expect(problems).toHaveCount(2);
  await expect(problems.nth(0)).toContainText("Labeled frames: labels up to frame 199 in the .nwb");
  await expect(problems.nth(1)).toContainText("Pose samples: 200 samples in the .nwb");
  await expect(page.locator("#slpStatus")).toBeHidden();

  // A file that does fit clears the refusal.
  await page.locator("#slpFile").setInputFiles(COVERS_PART);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");
  await expect(page.locator("#slpError")).toBeHidden();
});
