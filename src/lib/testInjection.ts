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
  /** Synthesizes a pose model alongside the mock video, once it has loaded. */
  mockSlp: boolean;
  /** Makes the synthesized pose deliberately describe a different recording than the mock video, so
   * the SLEAP card's mismatch refusal can be previewed instead of a clean overlay. */
  mismatch: boolean;
  /** Fakes the EMBER browse pane's dataset/video listing with this many video files spread across a
   * handful of fake datasets, bypassing `listManifestObjects`/`listOwnedEmbargoedDandisets`. Null
   * when `remote_listing` was not given. */
  remoteListing: number | null;
  /** Freezes an upload's progress right after it starts, indefinitely, for deterministic
   * screenshotting of the in-flight state. Never actually contacts the archive. */
  freezeUpload: boolean;
}

/** Nothing to fake: every field is the value that leaves every real code path untouched. */
const INERT: TestInjection = {
  signedOut: false,
  numDatasets: null,
  embargoed: true,
  humanSubjects: false,
  mockVideoFrames: null,
  mockSlp: false,
  mismatch: false,
  remoteListing: null,
  freezeUpload: false,
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
  return {
    signedOut: params.has("signed_out"),
    numDatasets: numDatasetsRaw !== null ? intParam(params, "num_datasets", 0) : null,
    embargoed: params.get("embargoed") !== "false",
    humanSubjects: params.has("human_subjects"),
    mockVideoFrames: mockVideoRaw !== null && mockVideoRaw > 0 ? mockVideoRaw : mockVideoRaw !== null ? 30 : null,
    mockSlp: params.has("mock_slp"),
    mismatch: params.has("mismatch"),
    remoteListing: params.has("remote_listing") ? intParam(params, "remote_listing", 8) : null,
    freezeUpload: params.has("freeze_upload"),
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

/**
 * Fakes the EMBER browse pane's listing: `n` video files, spread across as many fake datasets as it
 * takes to hold `FAKE_VIDEOS_PER_DATASET` each, bypassing the real bucket listing and manifest reads.
 * The video URLs resolve nowhere real — clicking one shows the ordinary "cannot be opened" refusal,
 * which is a truthful answer for a source this module invented, not a dead button.
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
        path: `sub-${d + 1}/session-${i + 1}.mp4`,
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
