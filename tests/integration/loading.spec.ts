import { test, expect } from "@playwright/test";
import { recordClipBytes, stageRecordedFile } from "./helpers";

// Opening a video is work this page does on its own thread — a container index parsed here, a first
// frame decoded here — so for a large recording there is a stretch where nothing on the page answers
// a click. These specs check that the stretch is announced on the picker the file was handed to, and
// that the announcement is drawn rather than merely set.

interface LoadWatch {
  /** What the dropzone said in the same tick the file was handed over, before anything awaited. */
  labelAtHandover: string;
  detailAtHandover: string;
  busyAtHandover: string | null;
  /** Whether the card's own line was raised as well — it should not be, the dropzone having
   * answered for this one. */
  cardLineAtHandover: boolean;
  /** Whether an animation frame ever saw the dropzone's line up — that is, whether it was drawn. */
  painted: boolean;
}

test("a local video is named by the dropzone it was handed to, drawn before the open blocks", async ({ page }) => {
  await page.goto("/");
  await stageRecordedFile(page, "dropped-clip.webm");

  const watch = await page.evaluate<LoadWatch>(() => {
    const line = document.querySelector<HTMLElement>("#dropzoneBusy")!;
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
      labelAtHandover: line.hidden ? "" : (document.querySelector<HTMLElement>("#dropzoneBusyLabel")!.textContent ?? ""),
      detailAtHandover: document.querySelector<HTMLElement>("#dropzoneBusyDetail")!.textContent ?? "",
      busyAtHandover: card.getAttribute("aria-busy"),
      cardLineAtHandover: !document.querySelector<HTMLElement>("#loadBusy")!.hidden,
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

  // The file that was chosen, named where it was chosen, before the open has had a chance to hold
  // the thread — and with its size, which is what makes a long wait make sense.
  expect(watch.labelAtHandover).toBe("dropped-clip.webm");
  expect(watch.detailAtHandover).toMatch(/selected$/);
  expect(watch.busyAtHandover).toBe("true");
  // One acknowledgement, not two: the card's line is for the sources that have no dropzone.
  expect(watch.cardLineAtHandover).toBe(false);
  // The point of the whole exercise: the line is not merely set, it is drawn. A line set and then
  // buried under an open that holds this thread is a page that still looks seized up — which is why
  // loadVideo hands the browser a frame for it before starting one (see main.ts's nextPaint).
  expect(watch.painted).toBe(true);

  // And the dropzone goes back to inviting a video once one is on the stage.
  await expect(page.locator("#dropzoneBusy")).toBeHidden();
  await expect(page.locator("#loadCard")).not.toHaveAttribute("aria-busy");
  await expect(page.locator("#dropzone")).toContainText("Drop a video here");
});

test("the dropzone says it is waiting from the moment the picker opens, not the moment the file lands", async ({ page }) => {
  await page.goto("/");
  // The picker is opened for real; nothing is chosen in it here.
  page.on("filechooser", () => {});
  await stageRecordedFile(page, "chosen-clip.webm");

  await page.locator("#dropzone").click();
  // Between dismissing a picker and the browser handing the file over there is a stretch no page
  // is told about. This is what stands in it.
  await expect(page.locator("#dropzoneBusy")).toBeVisible();
  await expect(page.locator("#dropzoneBusyLabel")).toHaveText(/Waiting for the file/);

  // And it gives way to the file itself, rather than the two of them being separate states.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#videoFile")!;
    const transfer = new DataTransfer();
    transfer.items.add(window.__recordedClip!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#dropzoneBusyLabel")).toHaveText("chosen-clip.webm");
  await expect(page.locator("#view")).toBeVisible();
  await expect(page.locator("#dropzoneBusy")).toBeHidden();
});

test("a picker dismissed without a file takes the waiting line back down", async ({ page }) => {
  await page.goto("/");
  page.on("filechooser", () => {});

  await page.locator("#dropzone").click();
  await expect(page.locator("#dropzoneBusy")).toBeVisible();

  // What a browser fires when the picker is closed with nothing chosen.
  await page.evaluate(() => document.querySelector("#videoFile")!.dispatchEvent(new Event("cancel")));
  await expect(page.locator("#dropzoneBusy")).toBeHidden();
  await expect(page.locator("#dropzone")).toContainText("Drop a video here");
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

  // No dropzone was involved in this one, so the card answers for it.
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

  // The refusal is the stage's to report; a picker only ever says what is in progress, so a load
  // that ended — however it ended — takes the line with it rather than leaving it spinning.
  await expect(page.locator("#emptyStage")).toContainText("held-clip.webm");
  await expect(page.locator("#loadBusy")).toBeHidden();
  await expect(page.locator("#dropzoneBusy")).toBeHidden();
  await expect(page.locator("#loadCard")).not.toHaveAttribute("aria-busy");
});
