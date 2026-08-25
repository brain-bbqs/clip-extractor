import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { listTar, serveFfmpegCore } from "./helpers";

// A source recording is the one thing in a delivery that can carry sound, and BEP047 names such a
// file `_audiovideo` where a silent one is `_video`. Everything this app extracts drops audio on the
// way out (see lib/ffmpeg.ts), so the two suffixes land in one bundle at once: the copied-along
// source under `sourcedata/` takes `_audiovideo`, the clip cut out of it stays `_video`.
//
// Driven end to end rather than unit-mocked, because the part worth pinning down is that mediabunny
// really finds the track in a real container and really reports what lib/audioFormat.ts translates
// into BEP047's keys. `?test&mock_audio` records a near-silent tone into the synthesized mock video
// (see lib/testInjection.ts) so no binary fixture is needed.

const AUDIO_LINK = "/?test&mock_video&mock_audio&mock_ready&from_local&snippet";
const SOURCE_DIR = "sourcedata/rawbids/sub-unknown/beh";

test("a source video carrying sound is copied in as _audiovideo, described down to its codec, and clipped to a silent _video", async ({
  page,
}) => {
  // A snippet is a real ffmpeg.wasm encode: its 32MB core is served out of node_modules rather than
  // the CDN (see helpers.ts), so the encode is the app's own and still needs no network.
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await serveFfmpegCore(page);
  await page.goto(AUDIO_LINK);
  await expect(page.locator("#btnDownload")).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), page.locator("#btnDownload").click()]);
  const entries = listTar(readFileSync((await download.path())!));
  const paths = entries.map((entry) => entry.path);

  // The source copy, and its sidecar beside it, both renamed for the sound they carry.
  expect(paths).toContain(`${SOURCE_DIR}/sub-unknown_audiovideo.mp4`);
  expect(paths).toContain(`${SOURCE_DIR}/sub-unknown_audiovideo.json`);
  // And nothing left under the silent spelling — the suffix replaces `_video`, it does not join it.
  expect(paths.filter((path) => path.startsWith(`${SOURCE_DIR}/sub-unknown_video`))).toEqual([]);

  // The clip cut out of that same source: still `_video`, its audio dropped by the extraction.
  const clip = paths.find((path) => path.startsWith("derivatives/") && path.endsWith(".mp4"));
  expect(clip).toMatch(/_video\.mp4$/);

  const sourceSidecar = JSON.parse(entries[paths.indexOf(`${SOURCE_DIR}/sub-unknown_audiovideo.json`)].text) as Record<string, unknown>;
  // What MediaRecorder is asked for and what a WebM carries it as: Opus, at the sample rate the
  // browser's own audio pipeline runs at. Codec and channel count are pinned; the rate is only held
  // to BEP047's own constraint on it, being the browser's to pick.
  expect(sourceSidecar.AudioCodec).toBe("opus");
  expect(sourceSidecar.AudioChannelCount).toBeGreaterThanOrEqual(1);
  expect(sourceSidecar.AudioSampleRate).toBeGreaterThan(0);
  // Compressed audio states no sample width in its codec name, and nothing here decodes the stream
  // to find one out, so the optional key is left out rather than guessed.
  expect(sourceSidecar).not.toHaveProperty("AudioBitDepth");
  // The picture keys are unaffected — the audio keys are added beside them, not in place of them.
  expect(sourceSidecar.ImageWidth).toBe(320);
  expect(sourceSidecar.ImageHeight).toBe(240);

  // The extract's own sidecar says nothing about sound, because the extract has none.
  const clipSidecar = JSON.parse(entries[paths.indexOf(clip!.replace(/\.mp4$/, ".json"))].text) as Record<string, unknown>;
  expect(Object.keys(clipSidecar).filter((key) => key.startsWith("Audio"))).toEqual([]);
});

test("the same recording without a sound track keeps BEP047's plain _video suffix", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clip-extractor.analytics-consent", "declined"));
  await page.goto("/?test&mock_video&mock_ready&from_local&frame");
  await expect(page.locator("#btnDownload")).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator("#btnDownload").click()]);
  const paths = listTar(readFileSync((await download.path())!)).map((entry) => entry.path);
  expect(paths).toContain(`${SOURCE_DIR}/sub-unknown_video.mp4`);
  expect(paths.filter((path) => path.includes("audiovideo"))).toEqual([]);
});
