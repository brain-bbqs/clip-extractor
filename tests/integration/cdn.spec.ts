import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { loadRecordedVideo, recordRequests, SLP_CLIP_FRAMES } from "./helpers";

// The app serves its own code. sleap-io.js parses a `.slp` in a Worker that imports h5wasm from
// jsDelivr unless it is handed a URL, so main.ts hands it the copy the build emits. (The ffmpeg.wasm
// core is the one deliberate exception, fetched from jsDelivr and checked against pinned digests in
// lib/ffmpeg.ts; the specs that encode serve it with serveFfmpegCore.)
const SLP_FIXTURE = fileURLToPath(new URL("../fixtures/mice_new.tracked.slp", import.meta.url));
const CDN = /^https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\//;

test("a .slp is parsed in a worker running the app's own h5wasm, with nothing fetched from a CDN", async ({ page }) => {
  const requests = recordRequests(page);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });

  await page.goto("/");
  await loadRecordedVideo(page, "mice_new.webm", SLP_CLIP_FRAMES);
  await page.locator("#slpFile").setInputFiles(SLP_FIXTURE);
  await expect(page.locator("#slpBadge")).toHaveText("30 frames");

  const origin = new URL(page.url()).origin;
  expect(requests.filter((url) => /\/assets\/h5wasm-[\w-]+\.js$/.test(url)).map((url) => new URL(url).origin)).toEqual([origin]);
  expect(requests.filter((url) => CDN.test(url))).toEqual([]);
  // Parsed by the worker itself, not by sleap-io.js's main-thread fallback after the worker failed.
  expect(warnings.filter((text) => text.includes("Worker-based loading failed"))).toEqual([]);
});
