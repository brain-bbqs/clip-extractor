import { test, expect, type Page } from "@playwright/test";

// Drives a real upload against a stubbed archive, to pin down the asset paths every file actually
// lands at: the directory's date/time/type entities, the extract's own entities, the sidecar that
// mirrors them, and the original video's untouched name. A single frame is used as the selection
// because that path needs no ffmpeg.wasm (and so no CDN) to produce a real file.

const API = "**/api-dandi.emberarchive.org/api/**";
const ADMIN_CHECK = "**/uploader-codycbakerphd.pythonanywhere.com/**";

/** Records a short VP8 clip in-page and hands it to the file input, as if it had been dropped. */
async function loadRecordedVideo(page: Page, filename: string): Promise<void> {
  await page.evaluate(async (name) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    for (let i = 0; i < 30; i++) {
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
  }, filename);
}

test("an upload registers the extract, the original and a matching provenance sidecar", async ({ page }) => {
  const registered: string[] = [];

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
  await page.route("https://s3.test/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        ETag: '"part-etag"',
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "PUT, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "ETag",
      },
      body: "",
    }),
  );

  await page.addInitScript(() => {
    localStorage.setItem(
      "clip-extractor.settings.v1",
      JSON.stringify({ oauth: { accessToken: "test-token", expiresAt: Date.now() + 3_600_000 }, deliveryMode: "upload" }),
    );
    localStorage.setItem("clip-extractor.analytics-consent", "declined");
  });

  await page.goto("/");
  await expect(page.locator("#dandisetSingleText")).toContainText("000123");

  await loadRecordedVideo(page, "file_example_480 - Copy.webm");
  await expect(page.locator("#view")).toBeVisible();
  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await page.locator("#frameSlider").fill("5");
  await expect(page.locator("#uploadOriginal")).toBeChecked();
  await expect(page.locator("#btnUpload")).toBeEnabled();

  await page.locator("#btnUpload").click();
  await expect(page.locator("#uploadStatus")).toHaveText("Upload complete", { timeout: 60_000 });

  expect(registered).toHaveLength(3);
  // One timestamped directory for the whole upload, tagged with what it holds.
  const directories = new Set(registered.map((path) => path.slice(0, path.lastIndexOf("/"))));
  expect(directories.size).toBe(1);
  expect([...directories][0]).toMatch(/^sourcedata\/raw\/clip-extractor\/date-\d{8}_time-\d{6}_type-frame$/);
  // The extract goes up first, then the original, then the sidecar naming both.
  expect(registered.map((path) => path.split("/").pop())).toEqual([
    "name-fileexample480+Copy_index-5_type-frame.png",
    "file_example_480-Copy.webm",
    "name-fileexample480+Copy_index-5_type-frame_provenance.json",
  ]);
});
