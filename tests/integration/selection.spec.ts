import { test, expect, type Page } from "@playwright/test";
import { loadRecordedVideo } from "./helpers";

// The snippet range is set by dragging two handles on a trim track, and read back (or typed) in the
// In/Current/Out fields under it. These specs drive the real gestures against a real loaded video,
// since the whole point of the handles is that they are pointer targets.

/** The last frame index of the loaded video, which the playhead slider already carries. */
async function lastFrame(page: Page): Promise<number> {
  return Number(await page.locator("#frameSlider").getAttribute("max"));
}

/** Page x of a frame on the trim track — the same mapping the app reads a pointer through. The
 * track sits below the fold on a default viewport, and `page.mouse` works in viewport coordinates,
 * so every measurement is taken with it scrolled into view. */
async function xOfFrame(page: Page, frame: number): Promise<{ x: number; y: number }> {
  await page.locator("#selbar").scrollIntoViewIfNeeded();
  const track = (await page.locator("#selbar").boundingBox())!;
  const max = await lastFrame(page);
  return { x: track.x + (frame / max) * track.width, y: track.y + track.height / 2 };
}

/** Drags one handle onto `frame`. The handle follows the pointer's absolute position rather than
 * its offset from where it was grabbed, so this lands on the frame exactly. */
async function dragHandle(page: Page, selector: string, frame: number): Promise<void> {
  const target = await xOfFrame(page, frame);
  const handle = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
});

test("the trim handles bound the snippet, and the range summary follows them", async ({ page }) => {
  await page.goto("/");
  await loadRecordedVideo(page, "trim.webm");
  const last = await lastFrame(page);

  // Nothing marked yet: both ends sit at the video's own bounds, shown as unset.
  await expect(page.locator("#inHandle")).toHaveClass(/unset/);
  await expect(page.locator("#outHandle")).toHaveClass(/unset/);
  await expect(page.locator("#inVal")).toHaveValue("");
  await expect(page.locator("#rangeSummary")).toContainText("full video");

  await dragHandle(page, "#inHandle", 5);
  // Dragging either handle commits both ends, so the band never has a "—" at one side of it.
  await expect(page.locator("#inHandle")).not.toHaveClass(/unset/);
  await expect(page.locator("#outHandle")).not.toHaveClass(/unset/);
  await expect(page.locator("#inVal")).toHaveValue("5");
  await expect(page.locator("#outVal")).toHaveValue(String(last));

  await dragHandle(page, "#outHandle", last - 5);
  await expect(page.locator("#outVal")).toHaveValue(String(last - 5));
  await expect(page.locator("#rangeSummary")).toContainText(`frames 5–${last - 5}`);
});

test("a handle dragged past its partner stops there instead of crossing it", async ({ page }) => {
  await page.goto("/");
  await loadRecordedVideo(page, "trim.webm");

  await dragHandle(page, "#inHandle", 4);
  await dragHandle(page, "#outHandle", 10);
  // Pulling In well beyond Out collapses the range onto Out rather than swapping the two, so the
  // handle under the pointer stays the one being moved.
  await dragHandle(page, "#inHandle", 20);
  await expect(page.locator("#inVal")).toHaveValue("10");
  await expect(page.locator("#outVal")).toHaveValue("10");
});

test("dragging the band between the handles slides the range without resizing it", async ({ page }) => {
  await page.goto("/");
  await loadRecordedVideo(page, "trim.webm");

  await dragHandle(page, "#inHandle", 4);
  await dragHandle(page, "#outHandle", 10);

  const from = await xOfFrame(page, 7);
  const to = await xOfFrame(page, 12);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator("#inVal")).toHaveValue("9");
  await expect(page.locator("#outVal")).toHaveValue("15");
});

test("frame indices can be typed into the readouts", async ({ page }) => {
  await page.goto("/");
  await loadRecordedVideo(page, "trim.webm");
  const last = await lastFrame(page);

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#curVal").fill("7");
  await page.locator("#curVal").press("Enter");
  await expect(page.locator("#overlayInfo")).toContainText("frame 7 /");

  // Out of range is clamped rather than rejected, so the field never shows a frame the player
  // is not actually on.
  await page.locator("#curVal").fill(String(last + 100));
  await page.locator("#curVal").press("Enter");
  await expect(page.locator("#curVal")).toHaveValue(String(last));
  await expect(page.locator("#overlayInfo")).toContainText(`frame ${last} /`);

  await page.locator('#modeSeg button[data-mode="video"]').click();
  await page.locator("#inVal").fill("3");
  await page.locator("#inVal").press("Enter");
  await page.locator("#outVal").fill("11");
  await page.locator("#outVal").press("Enter");
  await expect(page.locator("#rangeSummary")).toContainText("frames 3–11");
});

test("the ruler lays out time gradations, and stays put in frame mode", async ({ page }) => {
  await page.goto("/");
  await loadRecordedVideo(page, "trim.webm");

  // The recorded clip is about a second long, so this lands on the ruler's finest step: five
  // gradations, and one label at the start. The point of the assertion is that the ruler is built
  // from the loaded video rather than hard-coded.
  await expect(page.locator("#selruler .sel-tick")).toHaveCount(5);
  await expect(page.locator("#selruler .sel-tick-label").first()).toHaveText("0:00");

  // It sits outside the snippet-only wrapper, so a single frame is still placed against time.
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await expect(page.locator("#selruler")).toBeVisible();
  await expect(page.locator("#selbar")).toBeHidden();
});

test("a snippet selection survives a trip through frame mode", async ({ page }) => {
  await page.goto("/");
  await loadRecordedVideo(page, "trim.webm");

  await page.locator("#inVal").fill("4");
  await page.locator("#inVal").press("Enter");
  await page.locator("#outVal").fill("12");
  await page.locator("#outVal").press("Enter");
  await expect(page.locator("#rangeSummary")).toContainText("frames 4–12");

  // Looking at a single frame is a detour, not a reason to throw the range away.
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#curVal").fill("8");
  await page.locator("#curVal").press("Enter");

  await page.locator('#modeSeg button[data-mode="video"]').click();
  await expect(page.locator("#inVal")).toHaveValue("4");
  await expect(page.locator("#outVal")).toHaveValue("12");
  await expect(page.locator("#rangeSummary")).toContainText("frames 4–12");
});
