import { test, expect } from "@playwright/test";
import { loadRecordedVideo, seekTo, stubArchive } from "./helpers";

// Stopping a delivery that is already running (see lib/interrupt.ts). What makes this worth a real
// browser rather than a unit test is the part nothing else covers: that the card actually comes back
// — the Upload button returned, the video and pose swappable again — so an accidentally long
// selection can be adjusted and sent for a second time.

test("a running upload can be stopped, and the card comes back ready for an adjusted selection", async ({ page }) => {
  const { registered } = await stubArchive(page);

  // Holds the very first part transfer open, so the upload is still mid-file when Stop is pressed.
  // Registered last, so it takes precedence over the stub's own S3 route.
  let releaseTransfer = (): void => {};
  let transfersStarted = 0;
  const held = new Promise<void>((resolve) => (releaseTransfer = resolve));
  await page.route("https://s3.test/**", async (route) => {
    if (route.request().method() === "PUT") {
      transfersStarted++;
      await held;
    }
    await route.fulfill({
      status: 200,
      headers: {
        ETag: '"part-etag"',
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "PUT, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "ETag",
      },
      body: "",
    });
  });

  await page.goto("/");
  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  // A single frame, which needs no ffmpeg.wasm (and so no CDN) to produce a real file.
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 5);
  await page.locator("#selectionDescription").fill("Frame 5, sent by mistake — this is the one to call back.");

  const stop = page.locator("#btnStopUpload");
  const status = page.locator("#uploadStatus");
  // Nothing to stop until something is running.
  await expect(stop).toBeHidden();

  await page.locator("#btnUpload").click();
  // While it runs, Upload is off the card and Stop stands in its place, and neither the video nor
  // the pose can be swapped out from under the files being assembled.
  await expect(stop).toBeVisible();
  await expect(page.locator("#btnUpload")).toBeHidden();
  await expect(page.locator("#btnChangeVideo")).toBeDisabled();
  // Held at the first part transfer: the extract is encoded and hashed, and its bytes are on their
  // way to the bucket.
  await expect.poll(() => transfersStarted, { timeout: 60_000 }).toBe(1);

  await stop.click();
  await expect(status).toContainText("Upload stopped");
  // The stop landed while the first file's bytes were still moving, so nothing reached the dataset —
  // and the line says so rather than naming files that are not there.
  await expect(status).toContainText("Nothing reached the dataset");
  expect(registered).toEqual([]);

  // Back to where the card was: Upload on offer again, the progress bar gone, and the video and pose
  // swappable — which is what makes "adjust and try again" something that can actually be done.
  await expect(stop).toBeHidden();
  await expect(page.locator("#btnUpload")).toBeEnabled();
  await expect(page.locator("#uploadProgress")).toBeHidden();
  await expect(page.locator("#btnChangeVideo")).toBeEnabled();

  // The stopped line is an outcome, so it stays put while the selection is adjusted, and is retired
  // by the adjustment itself rather than by anything about it going stale.
  await seekTo(page, 7);
  await expect(status).not.toContainText("Upload stopped");

  releaseTransfer();
});
