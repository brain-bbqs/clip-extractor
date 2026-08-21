import { BufferTarget, CanvasSource, Output, QUALITY_LOW, WebMOutputFormat } from "mediabunny";
import type { IncomingDandiset } from "./dandisets";
import type { ArchiveDandiset, ArchiveVideo } from "./archives";

// Live smoketest URL params (`?test&...`), mirroring brain-bbqs/bbqs-uploader's own `?test` scheme
// (see its docs/README.md "Live Testing" section) so a link pasted into the deployed app's address
// bar drives the UI into a specific, real state — no local video file, no real sign-in, no real
// EMBER network call — purely so a human can eyeball every important UI state live and so Playwright
// specs can reach the same states without heavy `page.route` stubbing.
//
// This module only *parses* the query string into a plan; every field here is inert until main.ts
// reads it and, at the exact point each real code path would otherwise have made a network call or
// read real storage, substitutes the fake data below instead. That split keeps the fakes honest: a
// state built this way runs through the same rendering and validation code a real one would, so a
// screenshot of it is a screenshot of the real UI, not a mockup drawn beside it.
//
// `?test` alone (with none of the params below) is a no-op — every field defaults to off/null, so
// nothing downstream branches away from the ordinary boot path. Safe to try at any time: nothing
// here writes to real localStorage, nothing touches the real oauthTokens the sign-in flow holds, and
// every fake id is chosen from a range no real EMBER dandiset occupies (see FAKE_DANDISET_ID_BASE).

/** What one `?test&...` URL asks the app to fake. */
export interface TestInjection {
  /** Render every auth-dependent surface (header, delivery toggle, human-subjects gate, browse
   * pane) as signed out, regardless of what a real stored token says. The complement of
   * `numDatasets`, which needs to look signed in without one. */
  signedOut: boolean;
  /** Fakes the delivery destination's dataset list with this many negative-space datasets, bypassing
   * the real `listIncomingDandisets` call. Null when `num_datasets` was not given. */
  numDatasets: number | null;
  /** Whether the faked datasets are embargoed (the normal, uploadable case). `&embargoed=false`
   * previews the "not embargoed, upload disabled" error state. Only meaningful with `numDatasets`
   * set. */
  embargoed: boolean;
  /** Flags every faked dataset as holding human-subjects data, so the warning banner and blur tool
   * can be previewed without a real flagged dataset. Only meaningful with `numDatasets` set. */
  humanSubjects: boolean;
  /** Frame count for a synthesized, canvas-recorded clip to load as if it had been dropped in. Null
   * when `mock_video` was not given; defaults to 30 when given with no value. */
  mockVideoFrames: number | null;
  /** Duration, in seconds, of a synthesized long recording to load instead of `mockVideoFrames` —
   * previews the sliding-window timeline (see `showsWindow` in lib/timeline.ts) without the minutes
   * of real-time capture a genuinely long `mockVideoFrames` clip would cost. Null when
   * `mock_video_long` was not given; defaults to 14400 (4 hours) when given with no value, well past
   * merely the half-hour threshold that turns the window on at all. The widest window setting
   * (`±30 min`, a full hour) would otherwise still cover a 40-minute clip in its entirety, making the
   * window indistinguishable from no window at all. */
  mockVideoLongSeconds: number | null;
  /** Synthesizes a pose model alongside the mock video, once it has loaded. */
  mockSlp: boolean;
  /** Makes the synthesized pose deliberately describe a different recording than the mock video, so
   * the SLEAP card's mismatch refusal can be previewed instead of a clean overlay. */
  mismatch: boolean;
  /** Skips the manual steps a human would otherwise take before Save/Upload enable — selecting a
   * frame and typing a description — so a pasted `?test&mock_video&mock_ready` link lands directly on
   * a saveable state instead of the gated, "describe it first" one. Only meaningful alongside
   * `mockVideoFrames`/`mockVideoLongSeconds`; that gated state is itself worth previewing plain, which
   * is what `mock_video` without this produces. */
  mockReady: boolean;
  /** Fakes the EMBER browse pane's dataset/video listing with this many video files spread across a
   * handful of fake datasets, bypassing `listManifestObjects`/`listOwnedEmbargoedDandisets`. Null
   * when `remote_listing` was not given. */
  remoteListing: number | null;
}

/** Nothing to fake: every field is the value that leaves every real code path untouched. */
const INERT: TestInjection = {
  signedOut: false,
  numDatasets: null,
  embargoed: true,
  humanSubjects: false,
  mockVideoFrames: null,
  mockVideoLongSeconds: null,
  mockSlp: false,
  mismatch: false,
  mockReady: false,
  remoteListing: null,
};

/** A small, non-negative integer out of a query param, or `fallback` for anything else — including
 * the bare flag (`&mock_video&`), whose value is the empty string. */
function intParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Reads `?test&...` out of a query string, or null when the page was not asked to fake anything —
 * the ordinary case, which every caller should treat as "boot for real".
 */
export function readTestInjection(search: string): TestInjection | null {
  const params = new URLSearchParams(search);
  if (!params.has("test")) return null;
  const numDatasetsRaw = params.get("num_datasets");
  const mockVideoRaw = params.has("mock_video") ? intParam(params, "mock_video", 30) : null;
  const mockVideoLongRaw = params.has("mock_video_long") ? intParam(params, "mock_video_long", 14400) : null;
  return {
    signedOut: params.has("signed_out"),
    numDatasets: numDatasetsRaw !== null ? intParam(params, "num_datasets", 0) : null,
    embargoed: params.get("embargoed") !== "false",
    humanSubjects: params.has("human_subjects"),
    mockVideoFrames: mockVideoRaw !== null && mockVideoRaw > 0 ? mockVideoRaw : mockVideoRaw !== null ? 30 : null,
    mockVideoLongSeconds: mockVideoLongRaw !== null && mockVideoLongRaw > 0 ? mockVideoLongRaw : mockVideoLongRaw !== null ? 14400 : null,
    mockSlp: params.has("mock_slp"),
    mismatch: params.has("mismatch"),
    mockReady: params.has("mock_ready"),
    remoteListing: params.has("remote_listing") ? intParam(params, "remote_listing", 8) : null,
  };
}

/** Same as {@link readTestInjection}, for a caller that always wants a value rather than null —
 * every field reads as "off", so branching on it is always safe. */
export function testInjectionOrInert(search: string): TestInjection {
  return readTestInjection(search) ?? INERT;
}

/** The first fake numeric identifier this module hands out. EMBER's real dandiset ids are assigned
 * sequentially from 1 and, as of this writing, are nowhere near seven digits — chosen well above any
 * plausible real id rather than negative, because {@link resolveConfig}'s `dandisetId` regex only
 * matches plain digits and a fake id has to survive the same parsing a real one does to drive a
 * truthful preview of the upload-destination UI. */
const FAKE_DANDISET_ID_BASE = 9_900_001;

/** Fakes the delivery destination's dataset list `applyDatasetList` would otherwise be handed by a
 * real `listIncomingDandisets` call. */
export function fakeIncomingDatasets(count: number, embargoed: boolean, humanSubjects: boolean): IncomingDandiset[] {
  return Array.from({ length: count }, (_, i) => ({
    identifier: String(FAKE_DANDISET_ID_BASE + i),
    title: `Incoming: Test Lab ${i + 1}${humanSubjects ? " (human subjects)" : ""}`,
    embargoed,
  }));
}

/** Video files a fake browse listing spreads across each fake dataset — few enough that a small
 * `remote_listing=N` still lands in one dataset, the common case worth eyeballing first. */
const FAKE_VIDEOS_PER_DATASET = 4;

/** Zero-padded two digits, matching the `sub-01`/`ses-01` style BIDS entities are conventionally
 * written with — `lib/bidsPath.ts` itself does not require padding (`sub-1` is equally valid), but a
 * fake listing reads as more true-to-life dressed the way a real one almost always is. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Fakes the EMBER browse pane's listing: `n` video files, spread across as many fake datasets as it
 * takes to hold `FAKE_VIDEOS_PER_DATASET` each, bypassing the real bucket listing and manifest reads.
 * Each video's own path is BIDS-entity-shaped (`sub-01/ses-01/...`), the same structure a real
 * dandiset's own asset paths carry — so a listing built this way previews `lib/bidsPath.ts`'s
 * `behEntities` parsing the same way a real Browse EMBER selection would. The video URLs resolve
 * nowhere real — clicking one shows the ordinary "cannot be opened" refusal, which is a truthful
 * answer for a source this module invented, not a dead button.
 */
export function fakeArchiveBrowse(n: number): { datasets: ArchiveDandiset[]; videos: Map<string, ArchiveVideo[]> } {
  const datasetCount = Math.max(1, Math.ceil(n / FAKE_VIDEOS_PER_DATASET));
  const datasets: ArchiveDandiset[] = [];
  const videos = new Map<string, ArchiveVideo[]>();
  let remaining = n;
  for (let d = 0; d < datasetCount; d++) {
    const id = String(FAKE_DANDISET_ID_BASE + d);
    const count = Math.min(FAKE_VIDEOS_PER_DATASET, remaining);
    remaining -= count;
    const list: ArchiveVideo[] = Array.from({ length: count }, (_, i) => {
      const url = `https://test-injection.invalid/${id}/video-${i + 1}.mp4`;
      return {
        dandisetId: id,
        path: `sub-${pad2(d + 1)}/ses-${pad2(i + 1)}/video-${i + 1}.mp4`,
        size: 12_000_000 + i * 3_000_000,
        assetUrl: url,
        streamUrl: url,
        embargoed: false,
      };
    });
    videos.set(id, list);
    datasets.push({ id, version: "draft", manifestBytes: 4096, embargoed: false, name: `Test dataset ${d + 1}` });
  }
  return { datasets, videos };
}

/** Frame size for a synthesized mock video, matching what `tests/integration/helpers.ts`'s
 * `loadRecordedVideo` records — kept the same so a spec migrated onto `?test&mock_video` still
 * exercises the same 320×240 aspect the blur tool's radius defaults were tuned against. */
const MOCK_VIDEO_WIDTH = 320;
const MOCK_VIDEO_HEIGHT = 240;

/**
 * Synthesizes a short VP8 clip with MediaRecorder and hands it back as a File, ready to be passed to
 * the app's own `loadVideo` — the same technique `tests/integration/helpers.ts`'s `recordClipBytes`
 * uses from outside the page, run here from inside it so a pasted `?test&mock_video` URL needs no
 * local file and no Playwright driving it.
 */
export async function synthesizeVideoFile(frames: number, filename = "test-injection-mock-video.webm"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = MOCK_VIDEO_WIDTH;
  canvas.height = MOCK_VIDEO_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp8" });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = `hsl(${i * 10} 80% 50%)`;
    ctx.fillRect(0, 0, MOCK_VIDEO_WIDTH, MOCK_VIDEO_HEIGHT);
    // A frame number burned into the picture, so a screenshot of the mock video is recognizable as
    // one rather than indistinguishable from any other solid-color test clip.
    ctx.fillStyle = "#000";
    ctx.font = "20px sans-serif";
    ctx.fillText(`test frame ${i}`, 12, MOCK_VIDEO_HEIGHT - 16);
    await new Promise((r) => setTimeout(r, 33));
  }
  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
    recorder.stop();
  });
  return new File(chunks, filename, { type: "video/webm" });
}

/** How densely a synthesized long recording is sampled, in seconds per real frame. `showsWindow`
 * (see lib/timeline.ts) only needs `fps` — derived by `MediaBunnyVideoBackend.initialize()` in
 * `@talmolab/sleap-io.js` from `(frameCount - 1) / (lastPacketTimestamp - firstPacketTimestamp)` —
 * to clear a low bar, so a first attempt here used a fixed handful of frames regardless of duration.
 * That broke the trim track's own ruler: it turns a tick's *time* into a *frame index* by rounding
 * `seconds * fps` (see `rulerMarks`), and at a fps that low, every gradation across the default
 * ±30-minute window rounded to the same one or two frames, collapsing every label onto the same two
 * screen positions instead of spreading across the track. One frame every ten seconds keeps that
 * quantization well under a pixel at any window width offered (down to the narrowest, ±5 minutes),
 * while still costing a fraction of a second to encode — nothing close to the real-time cost
 * `synthesizeVideoFile` above would pay for the same duration. */
const LONG_MOCK_SECONDS_PER_FRAME = 10;

/**
 * Synthesizes a clip sampled at {@link LONG_MOCK_SECONDS_PER_FRAME} whose packets span
 * `durationSeconds`, to preview the sliding-window timeline a genuinely long recording gets past the
 * half-hour mark (`WINDOW_MIN_SECONDS` in lib/timeline.ts) without paying for it: `synthesizeVideoFile`
 * above records in real time, one second of capture per second of clip, so a multi-hour version of it
 * would take that many real hours. mediabunny's `Output`/`CanvasSource` write encoded samples at
 * whatever explicit timestamp they are given, decoupled from wall-clock time entirely, so the same
 * span of container duration comes from frames encoded in a fraction of a second.
 */
export async function synthesizeLongVideoFile(durationSeconds: number, filename = "test-injection-mock-long-video.webm"): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = MOCK_VIDEO_WIDTH;
  canvas.height = MOCK_VIDEO_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  // No `frameRate` metadata: that would snap these deliberately far-apart timestamps back together.
  const source = new CanvasSource(canvas, { codec: "vp8", quality: QUALITY_LOW });
  output.addVideoTrack(source);
  await output.start();
  const frameCount = Math.max(2, Math.round(durationSeconds / LONG_MOCK_SECONDS_PER_FRAME) + 1);
  const step = durationSeconds / (frameCount - 1);
  for (let i = 0; i < frameCount; i++) {
    const timestamp = i * step;
    ctx.fillStyle = `hsl(${i * 60} 80% 50%)`;
    ctx.fillRect(0, 0, MOCK_VIDEO_WIDTH, MOCK_VIDEO_HEIGHT);
    ctx.fillStyle = "#000";
    ctx.font = "20px sans-serif";
    ctx.fillText(`test frame ${i} @ ${Math.round(timestamp)}s`, 12, MOCK_VIDEO_HEIGHT - 16);
    await source.add(timestamp, step);
  }
  await output.finalize();
  return new File([target.buffer!], filename, { type: "video/webm" });
}
