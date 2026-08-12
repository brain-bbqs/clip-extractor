import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, seekTo, stubArchive, stubH5Wasm } from "./helpers";

// Delivering one selection twice — saving a bundle and then uploading it — must not extract or
// re-draw anything a second time. Drawing the pose overlay is the slowest thing this app does, so
// this counts the PNG encodes behind it: every frame of an extract or an overlay goes through
// canvas.toBlob, and a re-used one goes through nothing at all.
const SLP_FIXTURE = fileURLToPath(new URL("../fixtures/mice_new.tracked.slp", import.meta.url));

/** Counts canvas.toBlob calls in the page, from before any app code runs. */
async function countEncodes(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __encodes: number }).__encodes);
}

test("delivering the same selection twice re-uses the extract and the overlay", async ({ page }) => {
  await stubArchive(page);
  await stubH5Wasm(page);
  await page.addInitScript(() => {
    const win = window as unknown as { __encodes: number };
    win.__encodes = 0;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args: Parameters<HTMLCanvasElement["toBlob"]>) {
      win.__encodes++;
      return toBlob.apply(this, args);
    };
  });

  await page.goto("/");
  await loadRecordedVideo(page, "mice_new.webm");
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("The overlay here is worth keeping.");

  // Save first: one encode for the frame itself, one for the overlay drawn over it.
  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  await expect(page.locator("#downloadStatus")).toContainText("Saved");
  const afterSave = await countEncodes(page);
  expect(afterSave).toBe(2);

  // Then upload the very same selection: nothing left to draw.
  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toContainText("Upload complete", { timeout: 60_000 });
  expect(await countEncodes(page)).toBe(afterSave);

  // A different frame is a different selection, so that one is drawn.
  await seekTo(page, 9);
  await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page
      .locator('#deliverSeg button[data-deliver="download"]')
      .click()
      .then(() => page.locator("#btnDownload").click()),
  ]);
  expect(await countEncodes(page)).toBe(afterSave + 2);
});
