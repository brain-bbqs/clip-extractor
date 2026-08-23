import { test, expect, type Page } from "@playwright/test";

// The snippet range is set by dragging two handles on a trim track, and read back (or typed) in the
// In/Current/Out fields under it. These specs drive the real gestures against a real loaded video,
// since the whole point of the handles is that they are pointer targets. `?test&mock_video` loads
// it — a 30-frame synthesized clip, in place of the loadRecordedVideo() helper — since nothing here
// depends on the loaded file's name or exact content, only on there being one to drag handles over.

/** The last frame index of the loaded video, which the Current readout already carries as its max. */
async function lastFrame(page: Page): Promise<number> {
  return Number(await page.locator("#curVal").getAttribute("max"));
}

/** The range a freshly loaded video opens with: a fifth of the trim track in from each of its ends
 * (see lib/timeline.ts's defaultSelection). Derived from the video's own length rather than written
 * out, since MediaRecorder decides how many frames a `mock_video` capture really holds. On a clip
 * short enough to sit on the track whole, which every one here is, the track is the recording. */
async function defaultRange(page: Page): Promise<[number, number]> {
  const last = await lastFrame(page);
  return [Math.round(last * 0.2), Math.round(last * 0.8)];
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

/** Drags one marker onto `frame`. The marker follows the pointer's absolute position rather than
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

test("the trim handles bound the snippet, and the readouts follow them", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
  const last = await lastFrame(page);
  const [defaultIn, defaultOut] = await defaultRange(page);

  // A fresh video opens with a snippet already marked out on it, a fifth of the track in from each
  // end, rather than with both handles flat against the video's own bounds.
  await expect(page.locator("#inHandle")).not.toHaveClass(/unset/);
  await expect(page.locator("#outHandle")).not.toHaveClass(/unset/);
  await expect(page.locator("#inVal")).toHaveValue(String(defaultIn));
  await expect(page.locator("#outVal")).toHaveValue(String(defaultOut));

  await dragHandle(page, "#inHandle", 5);
  // Moving one end leaves the other where it was.
  await expect(page.locator("#inVal")).toHaveValue("5");
  await expect(page.locator("#outVal")).toHaveValue(String(defaultOut));

  await dragHandle(page, "#outHandle", last - 5);
  await expect(page.locator("#inVal")).toHaveValue("5");
  await expect(page.locator("#outVal")).toHaveValue(String(last - 5));
});

test("Reset range puts the snippet back where the video opened it", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
  const [defaultIn, defaultOut] = await defaultRange(page);

  await dragHandle(page, "#inHandle", 2);
  await dragHandle(page, "#outHandle", 4);
  await expect(page.locator("#inVal")).toHaveValue("2");

  // Back to the opening range rather than to nothing marked: a snippet always has two real ends, so
  // Save is never handed the whole recording under the name of a clip.
  await page.locator("#btnClearSel").click();
  await expect(page.locator("#inVal")).toHaveValue(String(defaultIn));
  await expect(page.locator("#outVal")).toHaveValue(String(defaultOut));
  await expect(page.locator("#selfill")).toBeVisible();
});

test("a handle dragged past its partner stops there instead of crossing it", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  await dragHandle(page, "#inHandle", 4);
  await dragHandle(page, "#outHandle", 10);
  // Pulling In well beyond Out collapses the range onto Out rather than swapping the two, so the
  // handle under the pointer stays the one being moved.
  await dragHandle(page, "#inHandle", 20);
  await expect(page.locator("#inVal")).toHaveValue("10");
  await expect(page.locator("#outVal")).toHaveValue("10");
});

test("a trim marker stays grabbable with the playhead parked on it", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  // The playhead starts at frame 0, and the In mark is pulled onto it, so its line then runs
  // straight down through the marker. The line is a readout rather than a target, so the press has
  // to reach the marker underneath it — otherwise a mark cannot be moved off the frame being
  // looked at.
  await expect(page.locator("#curVal")).toHaveValue("0");
  await dragHandle(page, "#inHandle", 0);
  await expect(page.locator("#inVal")).toHaveValue("0");

  await dragHandle(page, "#inHandle", 8);
  await expect(page.locator("#inVal")).toHaveValue("8");
  // ...and the playhead did not come along for the ride.
  await expect(page.locator("#curVal")).toHaveValue("0");
});

test("dragging the band between the handles slides the range without resizing it", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

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

test("the playhead is a marker on the same track, dragged and pressed for", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
  const last = await lastFrame(page);

  await dragHandle(page, "#playHandle", 12);
  await expect(page.locator("#curVal")).toHaveValue("12");
  await expect(page.locator("#overlayInfo")).toContainText("frame 12 /");

  // Pressing the track moves the playhead, not a trim end — the one gesture whose meaning does not
  // change with the selector mode. Frame 20 is inside the band the video opened with, so this also
  // covers the case the band would otherwise swallow: a press on it that never became a drag.
  const target = await xOfFrame(page, 20);
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#curVal")).toHaveValue("20");
  // The trim ends stayed where the load put them.
  const [defaultIn, defaultOut] = await defaultRange(page);
  await expect(page.locator("#inVal")).toHaveValue(String(defaultIn));
  await expect(page.locator("#outVal")).toHaveValue(String(defaultOut));

  // It survives into frame mode, where it is the whole selection.
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await expect(page.locator("#playHandle")).toBeVisible();
  await dragHandle(page, "#playHandle", last);
  await expect(page.locator("#curVal")).toHaveValue(String(last));
});

test("frame indices can be typed into the readouts", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
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
  // The band on the track is what a typed range has to reach, since the readouts would hold the
  // typed text either way.
  await expect(page.locator("#selfill")).toBeVisible();
  await expect(page.locator("#inHandle")).not.toHaveClass(/unset/);
  await expect(page.locator("#outHandle")).not.toHaveClass(/unset/);
});

test("the speed buttons pick a rate, and playback runs at it", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  const seg = page.locator("#speedSeg button");
  await expect(seg).toHaveText(["0.5×", "1×", "2×"]);
  await expect(seg.nth(1)).toHaveAttribute("aria-pressed", "true");

  await seg.nth(2).click();
  await expect(seg.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(seg.nth(1)).toHaveAttribute("aria-pressed", "false");

  // The pressed state has to reach playback, not just the button: play the same wall-clock stretch
  // at 2x and at 0.5x from the same frame, and the fast one must cover more ground.
  const advancedOver = async (ms: number) => {
    await page.locator("#curVal").fill("0");
    await page.locator("#curVal").press("Enter");
    await page.locator("#btnPlay").click();
    await page.waitForTimeout(ms);
    await page.locator("#btnPlay").click();
    return Number(await page.locator("#curVal").inputValue());
  };
  const fast = await advancedOver(400);
  await seg.nth(0).click();
  const slow = await advancedOver(400);
  expect(fast).toBeGreaterThan(slow);
});

test("playback stays inside the marked range, starting from In wherever the playhead was", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
  const last = await lastFrame(page);
  // In sits well down the clip so a playhead left at 0 would take a visible run-up to reach it,
  // which is exactly the stretch playback must not show.
  const inF = Math.round(last * 0.6);
  const outF = last - 1;

  // Handles are dragged without moving the playhead, so this is the ordinary case: a range marked
  // away from where the playhead happens to be sitting.
  await dragHandle(page, "#inHandle", inF);
  await dragHandle(page, "#outHandle", outF);
  await page.locator("#curVal").fill("0");
  await page.locator("#curVal").press("Enter");

  // Sampled throughout rather than once at the end: the frames to catch are the ones played on the
  // way in, and by the end of the run the playhead has wrapped into the band either way.
  await page.locator("#btnPlay").click();
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    seen.push(Number(await page.locator("#curVal").inputValue()));
    await page.waitForTimeout(100);
  }
  await page.locator("#btnPlay").click();

  expect(Math.min(...seen)).toBeGreaterThanOrEqual(inF);
  expect(Math.max(...seen)).toBeLessThanOrEqual(outF);
  // And it really ran, rather than sitting still at In for the whole sample.
  expect(Math.max(...seen)).toBeGreaterThan(inF);
});

test("the ruler lays out time gradations, and stays put in frame mode", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  // The recorded clip is about a second long, so this lands on the ruler's finest step: five
  // gradations, and one label at the start. The point of the assertion is that the ruler is built
  // from the loaded video rather than hard-coded.
  await expect(page.locator("#selruler .sel-tick")).toHaveCount(5);
  await expect(page.locator("#selruler .sel-tick-label").first()).toHaveText("0:00");

  // The track and its ruler are shared by both modes; only the trim markers and the band are
  // snippet-only, so a single frame is still placed against time.
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await expect(page.locator("#selruler")).toBeVisible();
  await expect(page.locator("#selbar")).toBeVisible();
  await expect(page.locator("#inHandle")).toBeHidden();
  await expect(page.locator("#outHandle")).toBeHidden();
  await expect(page.locator("#selfill")).toBeHidden();
});

test("a recording under half an hour carries no overview bar", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  // The overview only earns its row past half an hour of recording. A clip a second long is entirely
  // on the track already at a scale that can be aimed, so neither the bar nor the width control that
  // goes with it appears — and every marker below stays a marker on a track that reaches it.
  await expect(page.locator("#overviewWrap")).toBeHidden();
  await expect(page.locator("#windowSeg")).toBeHidden();
  // The width control still carries a width, ready for a recording long enough to want one.
  await expect(page.locator("#windowSeg button.active")).toHaveAttribute("data-half", "1800");
  await expect(page.locator("#selruler .sel-tick-label").first()).toHaveText("0:00");
  for (const marker of ["#inHandle", "#outHandle", "#playHandle"]) {
    await expect(page.locator(marker)).not.toHaveClass(/outside/);
  }
});

test("a recording over half an hour gets the sliding window and its width control", async ({ page }) => {
  // `?test&mock_video_long` (default 14400s = 4 hours) synthesizes a clip sampled once every ten
  // seconds of the target duration — see synthesizeLongVideoFile in lib/testInjection.ts. Two things
  // about it matter as much as crossing the half-hour threshold, and both broke this once: the
  // widest window setting is a full hour (`±30 min`), so a duration too close to the threshold would
  // leave the window covering the entire clip, indistinguishable from no window at all; and too
  // sparse a sampling collapses the trim track's ruler ticks (each rounded to its nearest real frame)
  // onto the same one or two screen positions instead of spreading across it.
  await page.goto("/?test&mock_video_long");
  await expect(page.locator("#view")).toBeVisible();

  await expect(page.locator("#overviewWrap")).toBeVisible();
  await expect(page.locator("#windowSeg")).toBeVisible();
  await expect(page.locator("#windowSeg button.active")).toHaveAttribute("data-half", "1800");
  // The slider that stands in for the whole recording, distinct from the trim track above it.
  await expect(page.locator("#overbar")).toBeVisible();

  // The window itself has to be a genuine fraction of the recording, not the whole of it stretched
  // out — otherwise the sliding window and the un-windowed case would look identical.
  const overbarBox = (await page.locator("#overbar").boundingBox())!;
  const overwinBox = (await page.locator("#overwin").boundingBox())!;
  expect(overwinBox.width).toBeLessThan(overbarBox.width * 0.5);

  // The trim track's own gradations have to be spread out too, not bunched at the edges: every major
  // tick's left offset, in order, strictly increasing.
  const tickLefts = await page
    .locator("#selruler .sel-tick.major")
    .evaluateAll((els) => els.map((el) => parseFloat((el as HTMLElement).style.left)));
  expect(tickLefts.length).toBeGreaterThan(3);
  for (let i = 1; i < tickLefts.length; i++) {
    expect(tickLefts[i]).toBeGreaterThan(tickLefts[i - 1]);
  }
});

test("a snippet selection survives a trip through frame mode", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  await page.locator("#inVal").fill("4");
  await page.locator("#inVal").press("Enter");
  await page.locator("#outVal").fill("12");
  await page.locator("#outVal").press("Enter");
  await expect(page.locator("#selfill")).toBeVisible();

  // Looking at a single frame is a detour, not a reason to throw the range away.
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#curVal").fill("8");
  await page.locator("#curVal").press("Enter");

  await page.locator('#modeSeg button[data-mode="video"]').click();
  await expect(page.locator("#inVal")).toHaveValue("4");
  await expect(page.locator("#outVal")).toHaveValue("12");
  await expect(page.locator("#selfill")).toBeVisible();
});
