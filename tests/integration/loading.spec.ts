import { test, expect } from "@playwright/test";
import { recordClipBytes, stageRecordedFile } from "./helpers";

// Opening a video is work this page does on its own thread — a container index parsed here, a first
// frame decoded here — so for a large recording there is a stretch where nothing on the page answers
// a click. These specs check that the stretch is announced on the picker the file was handed to, and
// that the announcement is drawn rather than merely set.

interface LoadWatch {
  /** Whether the line was up in the same tick the file was handed over, before anything awaited. */
  upAtHandover: boolean;
  labelAtHandover: string;
  busyAtHandover: string | null;
  /** Whether an animation frame ever saw it up — that is, whether it was ever actually drawn. */
  painted: boolean;
}

test("a local video says it is loading on the card it was dropped on, and gets it onto the screen", async ({ page }) => {
  await page.goto("/");
  await stageRecordedFile(page, "dropped-clip.webm");

  const watch = await page.evaluate<LoadWatch>(() => {
    const line = document.querySelector<HTMLElement>("#loadBusy")!;
    const card = document.querySelector<HTMLElement>("#loadCard")!;
    let painted = false;
    let watching = true;
    const look = (): void => {
      if (!line.hidden) painted = true;
      if (watching) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);

    const input = document.querySelector<HTMLInputElement>("#videoFile")!;
    const transfer = new DataTransfer();
    transfer.items.add(window.__recordedClip!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
    const handover = {
      upAtHandover: !line.hidden,
      labelAtHandover: document.querySelector<HTMLElement>("#loadBusyLabel")!.textContent ?? "",
      busyAtHandover: card.getAttribute("aria-busy"),
    };

    return new Promise<LoadWatch>((resolve) => {
      const settled = setInterval(() => {
        if (document.querySelector<HTMLCanvasElement>("#view")!.style.display !== "block") return;
        clearInterval(settled);
        watching = false;
        resolve({ ...handover, painted });
      }, 10);
    });
  });

  expect(watch.upAtHandover).toBe(true);
  expect(watch.labelAtHandover).toContain("dropped-clip.webm");
  expect(watch.busyAtHandover).toBe("true");
  // The point of the whole exercise: the line is not merely set, it is drawn. A line set and then
  // buried under an open that holds this thread is a page that still looks seized up — which is why
  // loadVideo hands the browser a frame for it before starting one (see main.ts's nextPaint).
  expect(watch.painted).toBe(true);

  // And it comes down again with the video on the stage, leaving the dropzone open for another.
  await expect(page.locator("#loadBusy")).toBeHidden();
  await expect(page.locator("#loadCard")).not.toHaveAttribute("aria-busy");
  await expect(page.locator("#dropzone")).toBeVisible();
});

const HELD_URL = "https://videos.test/held-clip.webm";

test("a streamed video says it is loading on the load card as well as over the stage", async ({ page }) => {
  await page.goto("/");
  const clip = await recordClipBytes(page);

  // Held until the spec has read both surfaces, standing in for the stretch a large recording spends
  // being read over the network.
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

  await expect(page.locator("#loadBusy")).toBeVisible();
  await expect(page.locator("#loadBusyLabel")).toHaveText(/held-clip\.webm/);
  await expect(page.locator("#stageBusy")).toBeVisible();

  release();
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator("#loadBusy")).toBeHidden();
});

test("a video that will not open leaves the load card free of the loading line", async ({ page }) => {
  await page.goto("/");
  await page.route(HELD_URL, (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "gone" }));

  await page.locator('#srcSeg button[data-src="ember"]').click();
  await page.locator("#emberUrl").fill(HELD_URL);
  await page.locator("#emberLoadBtn").click();

  // The refusal is the stage's to report; the picker only ever says what is in progress, so a load
  // that ended — however it ended — takes the line with it rather than leaving it spinning.
  await expect(page.locator("#emptyStage")).toContainText("held-clip.webm");
  await expect(page.locator("#loadBusy")).toBeHidden();
  await expect(page.locator("#loadCard")).not.toHaveAttribute("aria-busy");
});
