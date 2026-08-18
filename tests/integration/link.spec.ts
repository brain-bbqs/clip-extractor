import { test, expect, type Page } from "@playwright/test";
import { loadRecordedVideo, recordClipBytes, seekTo } from "./helpers";

// The address bar is the session (see src/lib/urlState.ts): a streamed video, the marks made in it
// and the description typed for the delivery all go into the query string, so a reload — or a link
// pasted to somebody else — opens on the same frames. These specs drive the real controls and then
// reload the page onto whatever the app wrote.

const CLIP_URL = "https://videos.test/linked-clip.webm";

/** Serves the clip at CLIP_URL for the rest of the spec, including across a reload. */
async function serveClip(page: Page): Promise<void> {
  const clip = await recordClipBytes(page);
  await page.route(CLIP_URL, (route) => route.fulfill({ status: 200, contentType: "video/webm", body: clip }));
}

async function streamClip(page: Page): Promise<void> {
  await page.locator('#srcSeg button[data-src="ember"]').click();
  await page.locator("#emberUrl").fill(CLIP_URL);
  await page.locator("#emberLoadBtn").click();
  await expect(page.locator("#view")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
});

test("a streamed video, its snippet and its description survive a reload", async ({ page }) => {
  await page.goto("/");
  await serveClip(page);
  await streamClip(page);

  await page.locator("#inVal").fill("4");
  await page.locator("#inVal").press("Enter");
  await page.locator("#outVal").fill("12");
  await page.locator("#outVal").press("Enter");
  await seekTo(page, 7);
  await page.locator("#selectionDescription").fill("the mouse rears");

  // Written after a pause, so a drag or a run of keystrokes only lands in the bar once.
  await expect.poll(() => page.url()).toContain(`url=${encodeURIComponent(CLIP_URL)}`);
  await expect.poll(() => page.url()).toContain("in=4&out=12&frame=7");

  await page.reload();
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator("#emberUrl")).toHaveValue(CLIP_URL);
  await expect(page.locator("#inVal")).toHaveValue("4");
  await expect(page.locator("#outVal")).toHaveValue("12");
  await expect(page.locator("#curVal")).toHaveValue("7");
  await expect(page.locator("#selectionDescription")).toHaveValue("the mouse rears");
});

test("the overlay switch travels in the link, and waits for a pose file to matter", async ({ page }) => {
  await page.goto("/");
  await serveClip(page);
  await streamClip(page);

  // The switch is on the player card, revealed along with the pose annotations step.
  await page.locator("#slpToggle").check();
  await page.locator("#showPose").uncheck();
  await expect.poll(() => page.url()).toContain("overlay=0");

  await page.reload();
  await expect(page.locator("#view")).toBeVisible();
  // Nothing on screen followed it back: with no pose loaded there is no overlay and no switch.
  await expect(page.locator("#showPoseRow")).toBeHidden();
  // It is what the switch reads once a pose does arrive — a file dropped in, or the step reopened.
  await page.locator("#slpToggle").check();
  await expect(page.locator("#showPose")).not.toBeChecked();
});

test("a link made in Frame mode opens back on the frame, in Frame mode", async ({ page }) => {
  await page.goto("/");
  await serveClip(page);
  await streamClip(page);

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await seekTo(page, 9);
  await expect.poll(() => page.url()).toContain("mode=frame");

  await page.reload();
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator('#modeSeg button[data-mode="frame"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#curVal")).toHaveValue("9");
});

test("a local file takes the streamed video's link down with it, rather than leaving a stale address", async ({ page }) => {
  await page.goto("/");
  await serveClip(page);
  await streamClip(page);
  await expect.poll(() => page.url()).toContain("url=");

  await loadRecordedVideo(page, "local.webm");
  // Nothing about a local session can be reopened from an address, so nothing is written into one.
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("a link whose video will not open stays in the bar, so a reload is another go at it", async ({ page }) => {
  await page.route(CLIP_URL, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "gone" }));
  await page.goto(`/?url=${encodeURIComponent(CLIP_URL)}&in=4&out=12`);

  await expect(page.locator("#emptyStage")).toContainText("linked-clip.webm");
  await expect.poll(() => page.url()).toContain(`url=${encodeURIComponent(CLIP_URL)}`);
  await expect(page.url()).toContain("in=4&out=12");
});
