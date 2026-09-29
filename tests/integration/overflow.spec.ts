import { test, expect, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "@brain-bbqs/test-utils/playwright";

// Every live test link in docs/README.md, loaded at the phone widths a visitor is likely to hold,
// must fit without a sideways scroll. The shared helper names whatever hangs past the right edge,
// which is far easier to act on than a screenshot of the page shifted sideways.

const PHONE_WIDTHS = [320, 360, 375, 390, 414];

/** The link, and what it has to have finished doing before its layout is the one worth checking. */
const STATES: { link: string; ready: (page: Page) => Promise<void> }[] = [
  { link: "/", ready: dropzone },
  { link: "/?test&signed_out", ready: dropzone },
  { link: "/?test&num_datasets=0", ready: dropzone },
  { link: "/?test&num_datasets=1", ready: dropzone },
  { link: "/?test&num_datasets=2", ready: dropzone },
  { link: "/?test&num_datasets=1&embargoed=false", ready: dropzone },
  { link: "/?test&num_datasets=1&human_subjects", ready: dropzone },
  { link: "/?test&mock_video", ready: video },
  { link: "/?test&mock_video=200", ready: video },
  { link: "/?test&mock_video_long", ready: video },
  { link: "/?test&mock_video&mock_audio", ready: video },
  { link: "/?test&mock_video&mock_slp", ready: (page) => expect(page.locator("#slpStatus")).toBeVisible() },
  { link: "/?test&mock_video&mock_slp&mismatch", ready: (page) => expect(page.locator("#slpError")).toBeVisible() },
  { link: "/?test&remote_listing=12", ready: (page) => expect(page.locator("#browseVideos li").first()).toBeVisible() },
  { link: "/?test&mock_video&mock_ready&from_local&frame", ready: saveable },
  { link: "/?test&mock_video&mock_ready&from_local&snippet", ready: saveable },
  { link: "/?test&mock_video&mock_ready&from_ember&frame", ready: saveable },
  { link: "/?test&mock_video&mock_ready&from_ember&snippet", ready: saveable },
];

async function dropzone(page: Page): Promise<void> {
  await expect(page.locator("#dropzone")).toBeVisible();
}

async function video(page: Page): Promise<void> {
  // A mock clip is recorded in real time, and `mock_video=200` is several seconds of it.
  await expect(page.locator("#view")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#btnChangeVideo")).toBeVisible();
}

async function saveable(page: Page): Promise<void> {
  await video(page);
  await expect(page.locator("#btnDownload")).toBeEnabled();
}

for (const { link, ready } of STATES) {
  for (const width of PHONE_WIDTHS) {
    test(`${link} fits a ${width}px-wide phone without a sideways scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(link);
      await ready(page);
      await expectNoHorizontalOverflow(page);
    });
  }
}
