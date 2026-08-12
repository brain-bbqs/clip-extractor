import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, stubArchive, stubH5Wasm, SLP_CLIP_FRAMES } from "./helpers";

// A `.slp` records the video it was labeled against. When that is not the video in the player, the
// pose would land on the wrong pixels of the wrong frames, so the SLEAP card refuses the file
// outright instead of overlaying it.
const SLP_FIXTURE = fileURLToPath(new URL("../fixtures/mice_new.tracked.slp", import.meta.url));
// The same annotations, but its video metadata describes a 1100-frame 1024×1024 recording rather
// than the 320×240 clip the specs synthesize.
const MISMATCHED_FIXTURE = fileURLToPath(new URL("../fixtures/mice_other.tracked.slp", import.meta.url));

test("a .slp labeled against another video is refused, naming what does not match", async ({ page }) => {
  await stubArchive(page);
  await stubH5Wasm(page);

  await page.goto("/");
  await loadRecordedVideo(page, "mice_new.webm", SLP_CLIP_FRAMES);
  await page.locator("#slpFile").setInputFiles(MISMATCHED_FIXTURE);

  await expect(page.locator("#slpError")).toBeVisible();
  await expect(page.locator("#slpErrorTitle")).toHaveText('"mice_other.tracked.slp" does not match "mice_new.webm".');
  const problems = page.locator("#slpErrorList li");
  await expect(problems).toHaveCount(2);
  await expect(problems.nth(0)).toContainText("Frame count: the .slp says 1100 frames");
  await expect(problems.nth(1)).toContainText("Frame size: the .slp says 1024×1024");
  await expect(page.locator("#slpError")).toContainText("Select another");
  // Nothing was loaded, so there is no badge and no overlay toggle to reach.
  await expect(page.locator("#slpStatus")).toBeHidden();

  // The matching file clears the refusal and loads normally.
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");
  await expect(page.locator("#slpError")).toBeHidden();
});
