import { test, expect } from "@playwright/test";
import { recordClipBytes } from "./helpers";

// A video named by URL is read over the network, so there is a stretch — the container index for a
// large recording, the whole file when it cannot be range-read — with nothing on the stage. These
// specs hold a stubbed video back to stand in for that stretch and check the player says so.

const HELD_URL = "https://videos.test/held-clip.webm";

test("the stage says a streamed video is loading, before the first frame is there to show", async ({ page }) => {
  await page.goto("/");
  const clip = await recordClipBytes(page);

  // Every request for the clip — the range reads that open it, and the whole-file fetch if it falls
  // back to one — waits here until the spec has seen what the stage says.
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(HELD_URL, async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: "video/webm", body: clip });
  });

  await page.locator('#srcSeg button[data-src="ember"]').click();
  await page.locator("#emberUrl").fill(HELD_URL);
  await page.locator("#emberLoadBtn").click();

  await expect(page.locator("#stageBusy")).toBeVisible();
  await expect(page.locator("#stageBusyLabel")).toHaveText(/held-clip\.webm/);
  // The indicator is standing in for the stage's "no video loaded" line, not sitting on top of it.
  await expect(page.locator("#emptyStage")).toBeHidden();

  release();
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator("#stageBusy")).toBeHidden();
});

test("a streamed video that cannot be fetched leaves the reason on the stage", async ({ page }) => {
  await page.goto("/");
  await page.route(HELD_URL, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "gone" }));

  await page.locator('#srcSeg button[data-src="ember"]').click();
  await page.locator("#emberUrl").fill(HELD_URL);
  await page.locator("#emberLoadBtn").click();

  await expect(page.locator("#emptyStage")).toContainText("held-clip.webm");
  await expect(page.locator("#stageBusy")).toBeHidden();
  await expect(page.locator("#view")).toBeHidden();
});

const HUGE_AVI_URL = "https://videos.test/recording.avi";

test("a large remote file in a container that cannot stream is refused before it is fetched", async ({ page }) => {
  await page.goto("/");
  const methods: string[] = [];
  await page.route(HUGE_AVI_URL, (route) => {
    methods.push(route.request().method());
    // Only the size is ever answered here: a GET reaching this handler is the download the guard
    // exists to prevent, and the spec below fails on having seen one.
    return route.fulfill({ status: 200, headers: { "content-length": String(3 * 1024 ** 3), "accept-ranges": "bytes" } });
  });

  await page.locator('#srcSeg button[data-src="ember"]').click();
  await page.locator("#emberUrl").fill(HUGE_AVI_URL);
  await page.locator("#emberLoadBtn").click();

  await expect(page.locator("#emptyStage")).toContainText("3.00 GB");
  await expect(page.locator("#emptyStage")).toContainText(".avi");
  await expect(page.locator("#stageBusy")).toBeHidden();
  expect(methods).toEqual(["HEAD"]);
});
