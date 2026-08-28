import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { recordClipBytes, stageRecordedFile } from "./helpers";

/** Where the spec below imports mediabunny from inside the page, and the copy `npm ci` already put
 * on disk to answer it with. Writing a clip with a chosen key-frame interval is the only way to know
 * where its key frames are, and MediaRecorder does not offer one. */
const MEDIABUNNY_URL = "https://mediabunny.test/mediabunny.mjs";
const MEDIABUNNY_MODULE = fileURLToPath(new URL("../../node_modules/mediabunny/dist/bundles/mediabunny.mjs", import.meta.url));

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
  // the thread.
  expect(watch.labelAtHandover).toBe("Loading video…");
  expect(watch.detailAtHandover).toContain("dropped-clip.webm");
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

test("a local video is opened on a worker, leaving the page free to answer while it is read", async ({ page }) => {
  await page.goto("/");
  // A fall back to opening it here says so in the console; the spec fails on having seen one, since
  // the in-thread path passes every other test in this file just as well while freezing the page.
  const fallbacks: string[] = [];
  page.on("console", (message) => {
    if (/off the page's thread/.test(message.text())) fallbacks.push(message.text());
  });
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await stageRecordedFile(page, "worker-clip.webm");

  const answered = await page.evaluate(async () => {
    // Clicks fired at the page throughout the load. On the thread that parses a container they wait
    // for it to finish, which for a large recording is the page refusing input outright.
    let clicks = 0;
    const target = document.querySelector<HTMLElement>("#srcSeg")!;
    target.addEventListener("click", () => clicks++);

    const input = document.querySelector<HTMLInputElement>("#videoFile")!;
    const transfer = new DataTransfer();
    transfer.items.add(window.__recordedClip!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
    const clicking = setInterval(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })), 20);

    await new Promise<void>((resolve) => {
      const settled = setInterval(() => {
        if (document.querySelector<HTMLCanvasElement>("#view")!.style.display !== "block") return;
        clearInterval(settled);
        resolve();
      }, 5);
    });
    clearInterval(clicking);
    return clicks;
  });

  expect(workers.some((url) => /videoWorker/.test(url))).toBe(true);
  expect(fallbacks).toEqual([]);
  expect(answered).toBeGreaterThan(0);
  await expect(page.locator("#view")).toBeVisible();
});

test("the loading card outlives the blank stage: it is up until the first frame is drawn", async ({ page }) => {
  await page.goto("/");
  await stageRecordedFile(page, "second-clip.webm");

  const order = await page.evaluate(async () => {
    const view = document.querySelector<HTMLCanvasElement>("#view")!;
    const busy = document.querySelector<HTMLElement>("#dropzoneBusy")!;
    const hand = (): void => {
      const input = document.querySelector<HTMLInputElement>("#videoFile")!;
      const transfer = new DataTransfer();
      transfer.items.add(window.__recordedClip!);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    };
    const drawn = (): boolean => {
      if (view.style.display !== "block" || !view.width) return false;
      const probe = document.createElement("canvas");
      probe.width = 8;
      probe.height = 8;
      const ctx = probe.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(view, 0, 0, 8, 8);
      // Anything but a bare canvas: the stage is cleared to transparent black on every load.
      return ctx.getImageData(0, 0, 8, 8).data.some((value, i) => i % 4 !== 3 && value > 0);
    };

    // One video loaded and playing, so a seek is in flight when the next one is handed over — the
    // case where the load's own seek is queued behind that one rather than drawing anything itself.
    hand();
    await new Promise<void>((resolve) => {
      const settled = setInterval(() => {
        if (!drawn()) return;
        clearInterval(settled);
        resolve();
      }, 5);
    });
    document.querySelector<HTMLButtonElement>("#btnPlay")!.click();
    await new Promise((resolve) => setTimeout(resolve, 150));

    let hiddenAt: number | null = null;
    let drawnAt: number | null = null;
    let sawCard = false;
    const watch = setInterval(() => {
      if (!busy.hidden) sawCard = true;
      if (sawCard && hiddenAt === null && busy.hidden) hiddenAt = performance.now();
      if (drawnAt === null && sawCard && drawn()) drawnAt = performance.now();
    }, 4);
    hand();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    clearInterval(watch);
    return { hiddenAt, drawnAt };
  });

  expect(order.hiddenAt).not.toBeNull();
  expect(order.drawnAt).not.toBeNull();
  // The card is what stands in for the picture, so it may not come down before there is one. A guard
  // on the order rather than a reproduction of a specific way of getting it wrong: the load waits on
  // the seek it starts even where that seek is queued behind one already running (see main.ts's
  // seekRun), and holds the card a frame past the draw so the two cannot land in either order.
  expect(order.drawnAt!).toBeLessThanOrEqual(order.hiddenAt!);
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
  await expect(page.locator("#dropzoneBusyLabel")).toHaveText("Loading video…");

  // And it gives way to the file itself, rather than the two of them being separate states.
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#videoFile")!;
    const transfer = new DataTransfer();
    transfer.items.add(window.__recordedClip!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  // The label does not change when the load starts — only the figure under it does, so the card
  // reads as one wait rather than as having restarted.
  await expect(page.locator("#dropzoneBusyLabel")).toHaveText("Loading video…");
  await expect(page.locator("#dropzoneBusyDetail")).toContainText("chosen-clip.webm");
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

test("a video that opens but cannot be decoded is refused, rather than leaving a blank stage", async ({ page }) => {
  await page.goto("/");
  // A container that reads perfectly and whose frames this browser cannot turn into pictures: a real
  // recording with its codec id rewritten, so the track opens, declares its size and frame count,
  // and then decodes to nothing. It stands in for the everyday version of the same thing — an H.264
  // recording on a browser built without H.264 — which is what turned up the bug.
  await stageRecordedFile(page, "undecodable.webm");
  await page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__recordedClip!.arrayBuffer());
    // Matroska's CodecID, as the ASCII it is stored as. The replacement is the same length, so every
    // element size around it still holds.
    const from = [...("V_VP8" as string)].map((c) => c.charCodeAt(0));
    const to = [...("V_AV1" as string)].map((c) => c.charCodeAt(0));
    for (let i = 0; i + from.length <= bytes.length; i++) {
      if (from.some((code, k) => bytes[i + k] !== code)) continue;
      to.forEach((code, k) => (bytes[i + k] = code));
      break;
    }
    window.__recordedClip = new File([bytes], "undecodable.webm", { type: "video/webm" });
  });

  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#videoFile")!;
    const transfer = new DataTransfer();
    transfer.items.add(window.__recordedClip!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });

  // Said where the video was asked for, and the player left as it was: a load that draws nothing
  // used to finish quietly all the same, switching the player on over a stage that stayed bare.
  await expect(page.locator("#emptyStage")).toContainText("undecodable.webm");
  await expect(page.locator("#view")).toBeHidden();
  await expect(page.locator("#dropzoneBusy")).toBeHidden();
  await expect(page.locator("#btnPlay")).toBeDisabled();
});

test("a video opens on a key frame, so the first picture costs one decode rather than a run of them", async ({ page }) => {
  await page.goto("/");
  // A clip whose key frames are a known distance apart: 90 frames at 30fps with one every second, so
  // they land on 0, 30 and 60. The snippet a load marks out starts a fifth in, at frame 18, which
  // sits 18 frames past the key frame before it — 18 frames of decoding before a picture, where the
  // key frame at 30 is one decode. 30 is inside the first half of the band (18..71), so that is
  // where the band starts instead.
  // Served off disk rather than fetched, the way the ffmpeg core is for the extraction specs: the
  // page under test is the built app, which carries no node_modules.
  await page.route(MEDIABUNNY_URL, (route) => route.fulfill({ contentType: "text/javascript", body: readFileSync(MEDIABUNNY_MODULE) }));
  await page.evaluate(async (MEDIABUNNY_URL) => {
    const { BufferTarget, CanvasSource, Output, QUALITY_LOW, WebMOutputFormat } = await import(/* @vite-ignore */ MEDIABUNNY_URL);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    const source = new CanvasSource(canvas, { codec: "vp8", quality: QUALITY_LOW, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: 30 });
    await output.start();
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `hsl(${i * 6} 80% 50%)`;
      ctx.fillRect(0, 0, 320, 240);
      await source.add(i / 30, 1 / 30);
    }
    await output.finalize();
    window.__recordedClip = new File([target.buffer!], "keyframes.webm", { type: "video/webm" });
  }, MEDIABUNNY_URL);

  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#videoFile")!;
    const transfer = new DataTransfer();
    transfer.items.add(window.__recordedClip!);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#view")).toBeVisible();

  // Rounded on to the key frame at 30 rather than left on 18. The playhead is still on In, which is
  // what a load marks out for it — the band moved, and the pair moved together.
  await expect(page.locator("#inVal")).toHaveValue("30");
  await expect(page.locator("#curVal")).toHaveValue("30");
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
