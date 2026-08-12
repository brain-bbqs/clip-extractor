import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

// Shared scaffolding for the upload specs: a stubbed archive (so nothing leaves the browser) and a
// synthesized video (so no binary video fixture has to be committed).

/** Frames to draw for a clip that will be paired with the `.slp` fixture: it labels frames 0-29, so
 * the recording has to still cover them after the recorder drops one or two. */
export const SLP_CLIP_FRAMES = 40;

const API = "**/api-dandi.emberarchive.org/api/**";
const ADMIN_CHECK = "**/uploader-codycbakerphd.pythonanywhere.com/**";

export interface StubbedArchive {
  /** Asset paths the app registers, in the order it registers them. */
  registered: string[];
  /** The bytes of every part PUT to S3, in the order they are sent — so a spec can read back what
   * was actually uploaded, not just where it landed. */
  uploaded: Buffer[];
}

/**
 * Moves the playhead onto a frame. The timeline carries no native slider to `fill()` — the playhead
 * is a marker dragged on the track — so the exact-value path is the Current readout, which is what
 * a spec that just needs to be on a known frame should drive.
 */
export async function seekTo(page: Page, frame: number): Promise<void> {
  await page.locator("#curVal").fill(String(frame));
  await page.locator("#curVal").press("Enter");
  await expect(page.locator("#curVal")).toHaveValue(String(frame));
}

/**
 * Stubs the archive, its admin-ownership check and S3, and signs the page in with a stored token.
 */
export async function stubArchive(page: Page): Promise<StubbedArchive> {
  const registered: string[] = [];
  const uploaded: Buffer[] = [];

  await page.route(API, (route) => {
    const url = route.request().url();
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/users/me/")) return json({ username: "ada-lovelace", name: "Ada Lovelace" });
    if (url.includes("/dandisets/?user=me")) {
      return json({ results: [{ identifier: "000123", embargo_status: "EMBARGOED", draft_version: { name: "Incoming: Test Lab" } }] });
    }
    if (url.includes("/uploads/initialize/")) {
      const { contentSize } = JSON.parse(route.request().postData()!) as { contentSize: number };
      return json({ upload_id: "u1", parts: [{ part_number: 1, size: contentSize, upload_url: "https://s3.test/part-1" }] });
    }
    if (url.includes("/uploads/u1/complete/")) return json({ complete_url: "https://s3.test/complete", body: "<xml/>" });
    if (url.includes("/uploads/u1/validate/")) return json({ blob_id: "blob-1" });
    if (url.includes("/versions/draft/assets/")) {
      if (route.request().method() === "GET") return json({ results: [], next: null });
      const { metadata } = JSON.parse(route.request().postData()!) as { metadata: { path: string } };
      registered.push(metadata.path);
      return json({ asset_id: "asset-1", path: metadata.path });
    }
    return json({});
  });

  await page.route(ADMIN_CHECK, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ adminOwned: true }) }),
  );

  // A real bucket has to expose ETag to the page for a browser upload to work at all (see
  // lib/s3.ts), so the stub does too — along with answering the PUT's cross-origin preflight.
  await page.route("https://s3.test/**", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataBuffer();
      if (body) uploaded.push(body);
    }
    return route.fulfill({
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

  await page.addInitScript(() => {
    localStorage.setItem(
      "clip-extractor.settings.v1",
      JSON.stringify({ oauth: { accessToken: "test-token", expiresAt: Date.now() + 3_600_000 }, deliveryMode: "upload" }),
    );
    localStorage.setItem("clip-extractor.analytics-consent", "declined");
  });

  return { registered, uploaded };
}

/**
 * sleap-io.js fetches h5wasm from jsDelivr at runtime to parse a `.slp` (both in its worker and on
 * its main-thread fallback), which would make these specs depend on a CDN — and fail outright in a
 * sandboxed environment. The same package is already in node_modules, so serve that instead.
 */
export async function stubH5Wasm(page: Page): Promise<void> {
  const local = readFileSync(fileURLToPath(new URL("../../node_modules/h5wasm/dist/iife/h5wasm.js", import.meta.url)), "utf8");
  await page.route("**/cdn.jsdelivr.net/npm/h5wasm*/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: local }),
  );
}

/** Records a short VP8 clip in-page and hands it to the file input, as if it had been dropped. A
 * synthesized video keeps a multi-megabyte fixture out of the repository.
 *
 * `frames` is how many are *drawn*; the recorder drops one or two, so a spec that pairs the clip
 * with the `.slp` fixture has to draw comfortably more than the 30 frames it labels — a clip that
 * ends before the last labeled frame is one the SLEAP card is right to refuse. */
export async function loadRecordedVideo(page: Page, filename: string, frames = 30): Promise<void> {
  await page.evaluate(
    async ({ name, frames }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      for (let i = 0; i < frames; i++) {
        ctx.fillStyle = `hsl(${i * 10} 80% 50%)`;
        ctx.fillRect(0, 0, 320, 240);
        await new Promise((r) => setTimeout(r, 33));
      }
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const input = document.querySelector<HTMLInputElement>("#videoFile")!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(chunks, name, { type: "video/webm" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    },
    { name: filename, frames },
  );
  await expect(page.locator("#view")).toBeVisible();
}
