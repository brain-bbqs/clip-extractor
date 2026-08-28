import { test, expect } from "@playwright/test";
import { stubArchive } from "./helpers";

test("loads the app shell as a file picker, with the player still off screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Clip Extractor");
  await expect(page.locator("h1")).toContainText("Clip Extractor");
  await expect(page.locator(".site-subtitle")).toHaveText(
    "Extract, describe, and share short clips or individual frames of behavioral recordings",
  );
  await expect(page.locator("#dropzone")).toBeVisible();
  // Nothing to play, so nothing that plays it: the card is the picker and only the picker.
  await expect(page.locator("#stage")).toBeHidden();
  await expect(page.locator("#playerControls")).toBeHidden();
  await expect(page.locator("#modeSeg")).toBeHidden();
  await expect(page.locator("#loadedSource")).toBeHidden();
  await expect(page.locator("#view")).toBeHidden();
  await expect(page.locator("#btnUpload")).toBeDisabled();
});

test("the picker gives way to the player once a video is open, and Change video brings it back", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();

  // The one card is the player now: the source picker that filled it has gone, and what it opened
  // is named in its place.
  await expect(page.locator("#dropzone")).toBeHidden();
  await expect(page.locator("#srcSeg")).toBeHidden();
  await expect(page.locator("#loadedSourceName")).toHaveText("test-injection-mock-video.mp4");
  await expect(page.locator("#modeSeg")).toBeVisible();
  await expect(page.locator("#playerControls")).toBeVisible();
  await expect(page.locator("#btnPlay")).toBeEnabled();
  // And there is something to describe and send, so the card that does that is on screen too.
  await expect(page.locator("#deliverCard")).toBeVisible();

  await page.locator("#btnChangeVideo").click();

  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#srcSeg")).toBeVisible();
  await expect(page.locator("#stage")).toBeHidden();
  await expect(page.locator("#playerControls")).toBeHidden();
  await expect(page.locator("#loadedSource")).toBeHidden();
  await expect(page.locator("#btnPlay")).toBeDisabled();
  // The recording is gone, and with it everything there was to send.
  await expect(page.locator("#deliverCard")).toBeHidden();
});

test("the pose card swaps its dropzone for what it read, and Change pose file brings it back", async ({ page }) => {
  await page.goto("/?test&mock_video&mock_slp");
  await expect(page.locator("#slpBadge")).toHaveText(/frames/);

  await expect(page.locator("#slpDropzone")).toBeHidden();
  await expect(page.locator("#slpNameLabel")).toHaveText("test-injection-mock.slp");

  await page.locator("#btnChangePose").click();

  await expect(page.locator("#slpDropzone")).toBeVisible();
  await expect(page.locator("#slpStatus")).toBeHidden();
  // The video it was overlaid on is untouched — the two files are separate steps.
  await expect(page.locator("#view")).toBeVisible();
});

test("brand watermarks and the version link frame the page", async ({ page }) => {
  // Wide enough that the fixed corner watermarks are in play (see the 1400px breakpoint in
  // style.css); narrower viewports fold them into the document flow instead.
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");

  const bbqs = page.locator(".brand-watermark-link");
  await expect(bbqs).toHaveAttribute("href", "https://brain-bbqs.org");
  await expect(bbqs.locator("img")).toBeVisible();
  // The BBQS mark is a square on a white field, so it is only a watermark once circularly masked.
  await expect(bbqs.locator("img")).toHaveCSS("border-radius", "50%");

  await expect(page.locator(".con-brand-link")).toHaveAttribute("href", "https://centerforopenneuroscience.org");
  await expect(page.locator(".con-brand-link img")).toBeVisible();
  const talmo = page.locator(".talmo-brand-link");
  await expect(talmo).toHaveAttribute("href", "https://talmolab.org/");
  // Only the variant matching the active theme is shown; this run is in the default light theme.
  await expect(talmo.locator(".talmo-brand-logo.on-light")).toBeVisible();
  await expect(talmo.locator(".talmo-brand-logo.on-dark")).toBeHidden();
  // The mark carries no wordmark of its own, so the name is spelled out under it.
  await expect(talmo).toHaveText("Talmo Lab");

  const version = page.locator("#version-indicator");
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+$/);
  await expect(version).toHaveAttribute("href", "https://github.com/brain-bbqs/clip-extractor");
});

test("source toggle swaps between the local dropzone and the EMBER stream pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#emberPane")).toBeHidden();

  await page.locator('#srcSeg button[data-src="ember"]').click();
  await expect(page.locator("#dropzone")).toBeHidden();
  await expect(page.locator("#emberUrl")).toBeVisible();

  await page.locator('#srcSeg button[data-src="local"]').click();
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#emberPane")).toBeHidden();
});

test("mode toggle switches the selector between range and single frame", async ({ page }) => {
  // The selector is part of the player, so it needs a recording under it to be on screen at all.
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
  // The track itself is shared: it carries the playhead in both modes.
  await expect(page.locator("#selbar")).toBeVisible();
  await expect(page.locator("#inVal")).toBeVisible();
  await expect(page.locator("#outVal")).toBeVisible();

  // The description prompt in the delivery card names whichever kind of selection is being made.
  await expect(page.locator("#selectionDescription")).toHaveAttribute("placeholder", /What event does this snippet showcase\?/);

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await expect(page.locator("#selbar")).toBeVisible();
  await expect(page.locator("#inVal")).toBeHidden();
  await expect(page.locator("#outVal")).toBeHidden();
  // The current frame is the frame-mode selection, so its field stays — and stays typeable.
  await expect(page.locator("#curVal")).toBeVisible();
  await expect(page.locator("#selectionDescription")).toHaveAttribute("placeholder", /What event does this frame showcase\?/);

  await page.locator('#modeSeg button[data-mode="video"]').click();
  await expect(page.locator("#inVal")).toBeVisible();
  await expect(page.locator("#outVal")).toBeVisible();
  await expect(page.locator("#selectionDescription")).toHaveAttribute("placeholder", /What event does this snippet showcase\?/);
});

test("the transport carries no first/last frame buttons", async ({ page }) => {
  await page.goto("/?test&mock_video");
  await expect(page.locator("#view")).toBeVisible();
  // Removed in favour of the timeline itself: dragging to either end is the same gesture as any
  // other seek, and the two buttons only ever crowded the row.
  await expect(page.locator("#btnFirst")).toHaveCount(0);
  await expect(page.locator("#btnLast")).toHaveCount(0);
  // Set In / Set Out went with them — the trim handles below the playhead replace them (the
  // `[ ] I O` shortcuts still mark either end at the playhead).
  await expect(page.locator("#btnSetIn")).toHaveCount(0);
  await expect(page.locator("#btnSetOut")).toHaveCount(0);
  await expect(page.locator("#btnPrev")).toBeVisible();
  await expect(page.locator("#btnPlay")).toBeVisible();
  await expect(page.locator("#btnNext")).toBeVisible();
});

test("SLEAP annotations card is revealed by its toggle (default off)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#slpToggle")).not.toBeChecked();
  await expect(page.locator("#slpCard")).toBeHidden();
  // With the step off there is no overlay to show, so the switch that shows it is off screen too.
  await expect(page.locator("#showPoseRow")).toBeHidden();

  await page.locator("#slpToggle").check();
  await expect(page.locator("#slpCard")).toBeVisible();
  await expect(page.locator("#slpDropzone")).toBeVisible();
  // Still nothing to draw an overlay over, though: that switch waits for a video.
  await expect(page.locator("#showPoseRow")).toBeHidden();

  await page.locator("#slpToggle").uncheck();
  await expect(page.locator("#slpCard")).toBeHidden();
});

test("the overlay switch comes and goes with the picture it draws on", async ({ page }) => {
  await page.goto("/?test&mock_video&mock_slp");
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator("#showPoseRow")).toBeVisible();
  await expect(page.locator("#showPose")).toBeChecked();

  await page.locator("#btnChangeVideo").click();
  await expect(page.locator("#showPoseRow")).toBeHidden();
});

test("delivery card offers only Save while signed out", async ({ page }) => {
  // The card waits for a recording, so this needs one open to look at the card at all.
  await page.goto("/?test&mock_video");
  await expect(page.locator("#deliverCard")).toBeVisible();
  await expect(page.locator("#oauthSigninBtn")).toBeVisible();
  // Upload is the only side the toggle leads to, so signed out there is no choice to offer.
  await expect(page.locator("#deliverToggleRow")).toBeHidden();
  await expect(page.locator("#uploadPane")).toBeHidden();
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#btnDownload")).toHaveText("Save");
  await expect(page.locator("#btnDownload")).toBeDisabled();
  await expect(page.locator("#downloadStatus")).toContainText("Describe the snippet");
});

test("delivery toggle appears once signed in and swaps between the save and upload panes", async ({ page }) => {
  // A fake, signed-in-looking destination — see lib/testInjection.ts — reaches the same UI as a real
  // sign-in for this test's purposes (toggling panes, nothing verified about an actual request).
  await page.goto("/?test&num_datasets=1&mock_video");
  await expect(page.locator("#deliverToggleRow")).toBeVisible();
  // The stored setting is still "download"/"upload"; only one label reads "Save".
  await expect(page.locator('#deliverSeg button[data-deliver="download"]')).toHaveText("Save");

  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(page.locator('#deliverSeg button[data-deliver="upload"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#uploadPane")).toBeVisible();
  await expect(page.locator("#downloadPane")).toBeHidden();
  // The recommended companion upload is on by default, and covers the video and any .slp.
  await expect(page.locator("#uploadOriginal")).toBeChecked();
  await expect(page.locator("#uploadOriginalRow")).toContainText("Include the original content");

  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#uploadPane")).toBeHidden();
});

test("the chosen delivery side survives a refresh", async ({ page }) => {
  await page.goto("/?test&num_datasets=1&mock_video");
  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(page.locator("#uploadPane")).toBeVisible();

  await page.reload();

  // Without the choice being persisted, the sign-in default would decide this again on every load.
  await expect(page.locator('#deliverSeg button[data-deliver="upload"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#uploadPane")).toBeVisible();
  await expect(page.locator("#downloadPane")).toBeHidden();

  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await page.reload();
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#uploadPane")).toBeHidden();
});

test("signing out takes the delivery toggle away and falls back to Save", async ({ page }) => {
  await stubArchive(page);
  await page.goto("/?test&mock_video");
  await expect(page.locator("#uploadPane")).toBeVisible();

  // The sign-out action lives in the avatar's hover popover.
  await page.locator("#oauthAvatar").hover();
  await page.locator("#oauthSignoutBtn").click();

  await expect(page.locator("#oauthSigninBtn")).toBeVisible();
  await expect(page.locator("#deliverToggleRow")).toBeHidden();
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#uploadPane")).toBeHidden();
});

test("sign-in button starts the EMBER OAuth redirect", async ({ page }) => {
  await page.goto("/");
  // The archive itself is out of scope for this smoke test: intercept the redirect and assert
  // only that the app leaves for the right authorize URL.
  await page.route("https://api-dandi.emberarchive.org/**", (route) => route.fulfill({ body: "" }));
  await page.locator("#oauthSigninBtn").click();
  await page.waitForURL(/api-dandi\.emberarchive\.org\/oauth\/authorize\//);
  const url = new URL(page.url());
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("response_type")).toBe("code");
});
