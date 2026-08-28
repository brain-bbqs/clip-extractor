import "./style.css";
import * as sio from "@talmolab/sleap-io.js";
import { getElements } from "./ui/elements";
import { bytes, fmtTime, rulerLabel } from "./lib/format";
import {
  defaultSelection,
  frameAt,
  fractionOf,
  hourMarks,
  rulerMarks,
  showsWindow,
  windowFor,
  windowHalfFrames,
  windowHalfSeconds,
  DEFAULT_WINDOW_HALF_SECONDS,
  type TimelineView,
} from "./lib/timeline";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "./lib/video";
import { openStreamingBlob, openStreamingUrl } from "./lib/streaming";
import { openWorkerBlob, workerVideoSupported } from "./lib/workerVideo";
import { withTimeout } from "./lib/timeout";
import {
  loadTimeoutRefusal,
  remoteFileSize,
  streamsEfficiently,
  unstreamableRefusal,
  wholeFileRefusal,
  ENCODING_HELPER_URL,
  LOAD_TIMEOUT_MS,
  PARAGRAPH,
  WHOLE_FILE_LIMIT_BYTES,
} from "./lib/streamable";
import { setMessage } from "./ui/linkify";
import { drawPose, labelsToPose } from "./lib/pose";
import {
  slpSourceMeta,
  slpVideoMismatches,
  slpVideoWarnings,
  type LoadedVideoMeta,
  type MetadataMismatch,
  type PoseFileKind,
  type SlpSourceMeta,
} from "./lib/match";
import { alignDenseFrames, probeNwbSeriesLength } from "./lib/nwb";
import { clampRegion, defaultBlurRadius, frameFit, maxBlurRadius, paintBlurRegions, MIN_BLUR_RADIUS, type BlurRegion } from "./lib/blur";
import { containsHumanSubjects, fetchDraftMetadata } from "./lib/humanSubjects";
import { ensureFreshToken, handleRedirectCallback, revokeToken, startLogin } from "./lib/oauth";
import { listIncomingDandisets, type IncomingDandiset } from "./lib/dandisets";
import {
  canSweep,
  dandisetWebUrl,
  fetchDandisetVideos,
  hydrateDandisetNames,
  archiveSourceOf,
  indexDandisets,
  listManifestObjects,
  mergeDandisets,
  sweepArchiveVideos,
  type ArchiveDandiset,
  type ArchiveSource,
  type ArchiveVideo,
} from "./lib/archives";
import {
  isAssetDownloadUrl,
  listEmbargoedVideos,
  listOwnedEmbargoedDandisets,
  listPublicDandisetIds,
  resolveEmbargoedStreamUrl,
} from "./lib/embargoed";
import { loadCachedNames, saveCachedNames } from "./lib/archiveNames";
import { loadStoredSettings, resolveConfig, saveStoredSettings } from "./lib/settings";
import {
  defaultDeliveryMode,
  deliveryDirectories,
  fileBrowserUrl,
  uploadAssetPath,
  type DeliveryDirectories,
  type DeliveryMode,
  type SelectionKind,
} from "./lib/delivery";
import { behEntities, sourcedataOriginalFilename, type BehEntities } from "./lib/bidsPath";
import { audioFormatInfo } from "./lib/audioFormat";
import { verbatimFilename } from "./lib/sanitize";
import {
  bundleFileName,
  extractClip,
  extractFrame,
  extractOverlay,
  sidecarFileName,
  type AssetEntities,
  type ExtractedMedia,
  type ExtractProgress,
  type ExtractSource,
} from "./lib/extract";
import { tarGzip, type BundleEntry } from "./lib/bundle";
import { memoOne } from "./lib/memo";
import { checksumBlob, uploadAsset, type BlobDigest, type UploadPhase } from "./lib/upload";
import {
  audioTechnicalFields,
  buildBehSidecar,
  buildCompanionSidecar,
  buildSourceDatasetEntry,
  imageTechnicalFields,
  videoTechnicalFields,
  type ProvenanceInput,
  type TechnicalDetail,
} from "./lib/provenance";
import { buildGeneratedByEntry } from "./lib/generatedBy";
import {
  mergedDatasetDescriptions,
  readExistingDatasetDescriptions,
  DATASET_DESCRIPTION_PATH,
  DERIVATIVES_DESCRIPTION_PATH,
  SOURCEDATA_DESCRIPTION_PATH,
  type ExistingDatasetDescriptions,
} from "./lib/datasetDescription";
import { fetchArchiveUser, type ArchiveUser } from "./lib/users";
import { friendlyError } from "./lib/errors";
import { renderIdentity } from "./ui/connection";
import { saveBlob } from "./ui/download";
import { BusyStatus } from "./ui/busyStatus";
import { readUrlState, stashUrlState, takeStashedUrlState, writeUrlState, type UrlState } from "./lib/urlState";
import {
  fakeArchiveBrowse,
  fakeIncomingDatasets,
  fromEmberArchiveSource,
  fromEmberSourceUrl,
  readTestInjection,
  synthesizeAudioVideoFile,
  synthesizeLongVideoFile,
  synthesizeVideoFile,
  type TestInjection,
} from "./lib/testInjection";
import type { ArchiveConfig, OAuthTokenSet, PoseInstance, PoseModel, SelectorMode, SleapLabels, SleapVideoBackend } from "./lib/types";

// Injected at build time from package.json's version (see configs/appVersion.ts).
declare const __APP_VERSION__: string;

const els = getElements();

els.versionIndicator.textContent = `v${__APP_VERSION__}`;

// ============================================================
// Live smoketest URL params (see lib/testInjection.ts and docs/README.md's "Live Testing" section)
// ============================================================
// Parsed once, at the top of boot, so every render path below can branch on it before its first
// paint rather than faking a state and then correcting it. Null on every ordinary load: `?test` is
// never present outside of somebody deliberately pasting one of these URLs.
const testInjection = readTestInjection(location.search);

/** What the stage says with nothing loaded and nothing gone wrong, kept from the markup so a fresh
 * attempt can put it back over the last one's refusal. */
const EMPTY_STAGE_DEFAULT = els.emptyStage.textContent;

// The links the app may put in a message. A message can quote a name taken from the `?url=`
// parameter or an error a server wrote, so what is turned into a link is chosen from this list
// rather than from whatever in the text reads like a URL — see ui/linkify.ts.
const APP_LINKS: readonly string[] = [ENCODING_HELPER_URL];

// Load/seek diagnostics go to the browser console — the interface deliberately has no on-page
// log panel.
type LogClass = "err" | "ok" | "warn" | "";
function log(msg: string, cls: LogClass = ""): void {
  if (cls === "err") console.error(msg);
  else if (cls === "warn") console.warn(msg);
  else console.info(msg);
}

// Since the console is the only place the log goes, it is also the only place anything says a video
// is on its way — so the waiting itself is reported on the page instead (see ui/busyStatus.ts).
// The stage answers for the player: a seek waiting on a frame is about the picture, and is said over
// it.
const stageStatus = new BusyStatus({ root: els.stageBusy, label: els.stageBusyLabel, detail: els.stageBusyDetail });
// The load card answers for the picker a video was asked from, which is where whoever asked is
// looking — and on a short window the only one of the two on screen.
const cardStatus = new BusyStatus({ root: els.loadBusy, label: els.loadBusyLabel, detail: els.loadBusyDetail });
// Except for a file handed to the dropzone, which answers for itself: a card-wide line under a
// dropzone still inviting a video is a poor acknowledgement of the one just chosen, and the dropzone
// is the thing being looked at at that moment. It takes the file's name in place of its invitation.
const dropzoneStatus = new BusyStatus({
  root: els.dropzoneBusy,
  label: els.dropzoneBusyLabel,
  detail: els.dropzoneBusyDetail,
});

/**
 * The stage and the picker at once, for the one wait that belongs in both places: opening a video.
 *
 * Which picker depends on where the video came from — see {@link pickedFrom}. Whichever it is, the
 * card goes `aria-busy` while the wait is up, which is what stops the local pane taking a second
 * file (see style.css). Opening a recording runs on this same thread — the container index is parsed
 * here, not in a worker — so a second one started on top of it lands in a page that cannot answer,
 * and a picker that looks ready while nothing it is clicked for happens is exactly what "the page
 * froze" means.
 */
const loadStatus = {
  /** Where the load in progress is being reported, what that surface calls it, and what it names
   * under that. All three set by {@link pickedFrom} as each load begins; an empty label means
   * "whatever the stage is saying". */
  picker: cardStatus,
  pickerLabel: "",
  pickerSubject: "",
  show(label: string, detail = ""): void {
    els.loadCard.setAttribute("aria-busy", "true");
    stageStatus.show(label, detail);
    // The picker's own label is fixed for the whole load while the figure under it moves. The stage
    // above rewrites its line as the load passes from one stage to the next, which is right over a
    // player nobody is reading closely; on the picker, a line that keeps being replaced under the
    // cursor that started it reads as the load restarting rather than progressing.
    const under = [this.pickerSubject, detail].filter(Boolean).join("  ·  ");
    this.picker.show(this.pickerLabel || label, under);
  },
  hide(): void {
    els.loadCard.removeAttribute("aria-busy");
    stageStatus.hide();
    // Both, not just the one in use: a load that changed surfaces must not leave the surface the
    // one before it used still spinning.
    cardStatus.hide();
    dropzoneStatus.hide();
  },
};

/** Points {@link loadStatus} at the picker `source` came from, and answers with what that picker
 * should open with.
 *
 * The dropzone says the one thing that stays true from the moment the picker opens to the moment
 * the video is on screen — {@link LOADING_VIDEO} — and names the file and its size underneath,
 * since nothing else on the page says what was chosen, and a size is what makes a long wait make
 * sense before a single byte has been counted. A URL or an archive video keeps the card's plain
 * "Loading …", its name having been typed or clicked a moment ago and still on screen beside it. */
function pickedFrom(source: File | string, name: string): string {
  const local = source instanceof File;
  loadStatus.picker = local ? dropzoneStatus : cardStatus;
  loadStatus.pickerLabel = local ? LOADING_VIDEO : "";
  loadStatus.pickerSubject = local ? name : "";
  return local ? `${bytes(source.size)}` : "";
}

/** What the dropzone says for as long as a video is on its way, from the picker opening to the first
 * frame being drawn. One line for the whole wait, rather than a different one per phase: what the
 * page is doing has not changed, and only the figure under it has anything new to say. */
const LOADING_VIDEO = "Loading video…";

/** Hands the browser a frame to draw in. Awaited where something just put on screen would otherwise
 * be raised and then buried under work that holds this thread: what is never painted is not a
 * notification, and a page that stops answering without one is indistinguishable from a page that
 * has crashed. */
function nextPaint(): Promise<void> {
  // The animation-frame callback runs *before* the paint it is scheduled for; the timeout inside it
  // is what lands after.
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

const ctx2d = els.view.getContext("2d");
if (!ctx2d) throw new Error("Canvas 2D context unavailable");
const ctx: CanvasRenderingContext2D = ctx2d;

// ============================================================
// Theme toggle (mirrors bbqs-uploader): the inline script in index.html already applied any
// stored override before first paint, so the toggle only has to flip and persist it. With
// nothing stored, data-theme is unset and the OS preference applies.
// ============================================================
const THEME_KEY = "clip-extractor.theme";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
els.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme ?? (prefersDark.matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    console.warn("Could not save theme preference:", e);
  }
});

// ============================================================
// State
// ============================================================
interface AppState {
  backend: SleapVideoBackend | null;
  frameOrder: number[] | null;
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  sourceName: string;
  sourceUrl: string | null;
  sourceFile: File | null;
  /** Where in the archive this video came from, when it was opened out of the browse pane — the
   * dandiset, its path within it, and the blob its bytes are stored as. Null for a locally dropped
   * file or an arbitrary streamed URL, neither of which the archive has any of this for. The path is
   * where a delivery's `sub-`/`ses-` entities come from (see lib/bidsPath.ts's behEntities; one that
   * names none falls back to `sub-unknown`), and the whole of it is what the derivatives
   * `SourceDatasets` records (see lib/provenance.ts's `buildSourceDatasetEntry`). */
  sourceArchive: ArchiveSource | null;
  cur: number;
  inF: number | null;
  outF: number | null;
  playing: boolean;
  speed: number;
  pose: PoseModel | null;
  /** The pose file behind `pose`, when it came from a local file — kept so it can ride along with
   * an upload. Null for one fetched from a URL, whose bytes were never held locally. */
  slpFile: File | null;
  /** Where `pose` was fetched from, when it came from a URL — the other half of slpFile above, and
   * the only half a link can carry. Null for a local file, and whenever `pose` is null. */
  poseUrl: string | null;
  /** Display name of the loaded pose file, including one loaded from a URL, so a later mismatch can
   * name it. Null whenever `pose` is null. */
  slpName: string | null;
  /** Which format `pose` was read from, so the card's notices name the file the reader dropped.
   * Null whenever `pose` is null. */
  slpKind: PoseFileKind | null;
  /** What the loaded pose file says about the video it was labeled against, re-checked whenever a
   * different video is opened underneath it. Null whenever `pose` is null. */
  slpMeta: SlpSourceMeta | null;
  mode: SelectorMode;
  /** Where the trim track sits in the recording. The track covers a window centred here rather than
   * the whole video once the video is long enough for that to matter (see lib/timeline.ts); until
   * then the window is the whole video and this has nothing to do. */
  viewCenter: number;
  /** How much of the recording the trim track covers either side of `viewCenter`. A working
   * preference rather than anything about the loaded video, so it survives opening another one. */
  windowHalf: number;
  /** Areas blurred out of everything extracted from this video, in source pixels. Placed with the
   * blur tool under the player, which the human-subjects gate reveals (see below). */
  blurRegions: BlurRegion[];
  curBitmap: ImageBitmap | ImageData | ArrayBuffer | { buffer: ArrayBufferLike } | null;
}

const state: AppState = {
  backend: null,
  frameOrder: null,
  totalFrames: 0,
  fps: 30,
  width: 0,
  height: 0,
  sourceName: "",
  sourceUrl: null,
  sourceFile: null,
  sourceArchive: null,
  cur: 0,
  inF: null,
  outF: null,
  playing: false,
  speed: 1,
  pose: null,
  slpFile: null,
  poseUrl: null,
  slpName: null,
  slpKind: null,
  slpMeta: null,
  mode: "video",
  viewCenter: 0,
  windowHalf: DEFAULT_WINDOW_HALF_SECONDS,
  blurRegions: [],
  curBitmap: null,
};

// Bumped by every successful load, so anything derived from the bytes behind the player (or behind
// the pose) can be keyed to the load it came from — two files can share a name, and re-dropping an
// edited one must not look like the same source. See the delivery caches below.
let sourceGeneration = 0;
let poseGeneration = 0;
// Same idea for the blur areas: moving, resizing or removing one changes every pixel an extraction
// would write, so anything already extracted has to be re-made rather than re-used.
let blurGeneration = 0;

// ============================================================
// The address bar (see lib/urlState.ts)
// ============================================================
// The session is written into the query string as it moves, so the address always links back to
// what is on screen: the streamed video and pose file, the marks made in them, and the description
// typed for the delivery. Reading it back is initFromUrl(), at the bottom of this file.

/** What the bar should be showing, as of now. */
function urlState(): UrlState {
  return {
    url: state.sourceUrl,
    pose: state.poseUrl,
    mode: state.mode,
    inF: state.inF,
    outF: state.outF,
    frame: state.backend ? state.cur : null,
    overlay: els.showPose.checked,
    description: els.selectionDescription.value,
  };
}

/** Puts a session in the bar, without adding a history entry: this is one session being adjusted,
 * not a trail of pages to press Back through. Defaults to the one on screen; the restore below
 * passes the link it was opening when that link did not open. */
function writeUrl(next: UrlState = urlState()): void {
  // A test-injection link belongs to its own harness, flags and all — several of them (`frame`,
  // `mode`) collide with this module's params, and re-serializing would strip those and turn every
  // bare `&flag` into `&flag=`. A mock session is not one anybody links back into anyway.
  if (testInjection) return;
  const search = writeUrlState(location.search, next);
  if (search === location.search) return;
  history.replaceState(history.state, "", `${location.pathname}${search}${location.hash}`);
}

// How long the writes are coalesced for. Every seek, every drag of a handle and every keystroke in
// the description moves the session, and browsers do not take an address change per animation frame
// — Safari counts them and throws once a hundred land inside thirty seconds. Trailing-only, so a
// drag, or a stretch of playback, writes once when it comes to rest.
const URL_SYNC_MS = 400;
let urlSyncTimer: ReturnType<typeof setTimeout> | undefined;

/** Schedules a write of the bar. Safe to call from anything that moves the session. */
function syncUrl(): void {
  clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(writeUrl, URL_SYNC_MS);
}

// ============================================================
// Video loading (remote URL + local file)
// ============================================================
/** An opened source plus the local bytes behind it, if any: `file` is null only for a URL that is
 * genuinely being range-streamed, so extraction and the "upload the original too" option can tell
 * "bytes in hand" from "would have to be fetched". */
interface OpenedSource {
  backend: SleapVideoBackend;
  file: File | null;
}

// Decoded frames the backend keeps as ImageBitmaps. Each one costs width*height*4 bytes of
// (non-JS-heap) memory, so at 1080p a 96-frame cache is ~800MB — enough that a large .slp on the
// heap alongside it pushes the tab into thrashing. 32 still covers the read-ahead window below.
const FRAME_CACHE_SIZE = 32;

// Opening a long recording means reading its container index, which for a multi-gigabyte file is
// itself tens of megabytes over the network. That is a wait worth reporting rather than sitting
// through in silence, so the read is logged as it goes, no more often than this.
const INDEX_PROGRESS_MS = 2000;

// How often the same count is refreshed on screen, where it is the only sign the tab is doing
// anything at all: often enough to read as movement, rarely enough that a fast source is not
// repainting both indicators on every chunk it receives.
const LOAD_PROGRESS_MS = 250;

/** A throttled reporter for how much of `name` has been read while it is being opened.
 *
 * A running total only, never a fraction of the file, even where the file's own size is in hand: a
 * container index is read by seeking around the file, and a stretch wanted twice is counted twice,
 * so this passes the size of what is on the machine on the way to overtaking it. */
function indexProgress(name: string): (bytesRead: number) => void {
  let lastLog = 0;
  let lastPaint = 0;
  return (bytesRead) => {
    const now = Date.now();
    if (now - lastPaint >= LOAD_PROGRESS_MS) {
      lastPaint = now;
      loadStatus.show(`Loading ${name}…`, `${bytes(bytesRead)} read`);
    }
    if (now - lastLog < INDEX_PROGRESS_MS) return;
    lastLog = now;
    log(`Reading ${name}'s index… ${bytes(bytesRead)} so far`);
  };
}

/** Fetches a whole video, saying how far along it is as it goes. The fallback for a URL that could
 * not be range-streamed, which is the longest wait the app has: the entire recording arrives before
 * a single frame can be drawn, so it is the last place that should look like nothing happening.
 *
 * Refused for a file past {@link WHOLE_FILE_LIMIT_BYTES}, both on the length the server declares and
 * on the bytes that actually arrive — a server that declares no length, or a wrong one, would
 * otherwise fill the tab's memory on the strength of a header nobody checked. */
async function fetchWholeVideo(url: string, name: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching video`);
  const type = resp.headers.get("content-type") || "video/mp4";
  // Only a server that declares the length can be counted down to; without one the count still says
  // the download is moving.
  const total = Number(resp.headers.get("content-length")) || 0;
  const declared = wholeFileRefusal(total || null);
  if (declared) {
    // The headers are in but the body is not, and an abandoned one goes on being received until
    // the collector gets to it — which for the recordings this refuses is the whole problem.
    void resp.body?.cancel();
    throw new Error(declared);
  }
  const body = resp.body;
  if (!body) return resp.blob();
  const reader = body.getReader();
  const chunks: BlobPart[] = [];
  let read = 0;
  let lastPaint = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    read += value.byteLength;
    if (read > WHOLE_FILE_LIMIT_BYTES) {
      await reader.cancel();
      throw new Error(
        `${name} ran past the ${bytes(WHOLE_FILE_LIMIT_BYTES)} limit on a whole-file download, having never declared its size. ` +
          `Please use the Encoding Helper (${ENCODING_HELPER_URL}) to improve the video accessibility.`,
      );
    }
    const now = Date.now();
    if (now - lastPaint < LOAD_PROGRESS_MS) continue;
    lastPaint = now;
    loadStatus.show(`Downloading ${name}…`, total ? `${bytes(read)} of ${bytes(total)}` : `${bytes(read)} so far`);
  }
  return new Blob(chunks, { type });
}

/** Opens bytes already in hand, falling back through sleap-io.js's backends: its MediaBunny one
 * reads the whole file to index it (see lib/streaming.ts), which is slow but not wrong, and its
 * mp4box one covers files MediaBunny will not open at all. */
async function openLocalBackend(file: File, name: string): Promise<SleapVideoBackend> {
  // Reading a container's index is the longest thing this app does without waiting on anything, and
  // on this thread it is the page refusing clicks for as long as it takes. A file already on the
  // machine is opened on a worker instead (see lib/workerVideo.ts), where none of that is in the way
  // of a click. Anything that cannot be opened there falls through to the same backends as before,
  // which is also the whole of the answer for a browser without workers at all.
  if (workerVideoSupported()) {
    try {
      return await openWorkerBlob(file, name, { cacheSize: FRAME_CACHE_SIZE, onIndexProgress: indexProgress(name) });
    } catch (e) {
      log(`Opening ${name} off the page's thread failed (${(e as Error).message}); opening it here instead…`, "warn");
    }
  }
  try {
    return await openStreamingBlob(file, { cacheSize: FRAME_CACHE_SIZE, onIndexProgress: indexProgress(name) });
  } catch (e) {
    log(`Streaming open failed (${(e as Error).message}); indexing the whole file…`, "warn");
  }
  try {
    return await sio.MediaBunnyVideoBackend.fromBlob(file, name, { cacheSize: FRAME_CACHE_SIZE });
  } catch (e) {
    log(`MediaBunny failed (${(e as Error).message}); trying mp4box…`, "warn");
    const vb = await sio.createVideoBackend(file, { backend: "mp4box" });
    const maybeReady = (vb as { ready?: Promise<unknown> }).ready;
    if (maybeReady) await maybeReady;
    return vb;
  }
}

/** The open source as extraction and provenance see it, or null for one that can say nothing about
 * itself. Asked by what a backend carries rather than which class it is: a local file's container is
 * open on a worker and a streamed one's on this thread, and both describe their own bitstream. */
function describedSource(backend: SleapVideoBackend | null | undefined): ExtractSource | null {
  return backend && "technical" in backend ? (backend as unknown as ExtractSource) : null;
}

/**
 * Refuses a remote source that cannot be read a piece at a time before a byte of it is fetched.
 *
 * Only a container known not to stream is checked, and only that check costs a request: a size is
 * asked of the server for it, because a URL — unlike a video picked out of the archive — arrives
 * with nothing but a name. Everything else goes straight to the streaming open, which settles the
 * question by trying it, and falls through to the whole-file guard in {@link fetchWholeVideo} when
 * the answer is no.
 */
async function refuseUnstreamable(url: string, name: string): Promise<void> {
  if (streamsEfficiently(name)) return;
  loadStatus.show(`Checking ${name}…`);
  const size = await remoteFileSize(url);
  const refusal = unstreamableRefusal(name, size);
  if (refusal) throw new Error(refusal);
  log(`${name} cannot be streamed, so all ${bytes(size)} of it will be downloaded first`, "warn");
}

/**
 * Hands `backend` back only once a frame has come out of it.
 *
 * Opening and decoding are different questions, and the last of the fallbacks below answers only the
 * first: sleap-io.js's backends read a container without asking whether this browser has a decoder
 * for what is inside it, so a file in a codec the browser will not touch opens, reports its size and
 * frame count, and then draws nothing. What that looked like was a load that finished — the
 * indicator came down, the player switched on — over a stage that stayed blank, with the only word
 * of it in the console. Asked here instead, where the answer is still a refusal the picker can
 * report, and at no cost to a source that can decode: the frame is the one the player is about to
 * ask for, and it is already cached by the time it does.
 */
async function requireFirstFrame(backend: SleapVideoBackend, name: string): Promise<SleapVideoBackend> {
  const frame = await backend.getFrame(0).catch(() => null);
  if (frame) return backend;
  backend.close?.();
  throw new Error(
    `${name} opened, but this browser could not decode any of its frames. ` +
      `Please use the Encoding Helper (${ENCODING_HELPER_URL}) to improve the video accessibility.`,
  );
}

async function openVideoBackend(source: File | string, name: string): Promise<OpenedSource> {
  if (typeof source === "string") {
    await refuseUnstreamable(source, name);
    try {
      const backend = await openStreamingUrl(source, {
        cacheSize: FRAME_CACHE_SIZE,
        onIndexProgress: indexProgress(name),
        // A URL's frames are found by reading the container, and a file whose container does not
        // say where they are leaves reading the file itself as the only way — which over a network
        // is the recording pulled through it whole, silently, for as long as that takes.
        maxIndexBytes: WHOLE_FILE_LIMIT_BYTES,
      });
      return { backend: await requireFirstFrame(backend, name), file: null };
    } catch (e) {
      // What the open failed with is left here rather than carried into the refusal: it is a
      // sentence about container internals, and the refusal is about a file being too large to
      // fetch and where to have it re-encoded.
      log(`Range/stream open failed (${(e as Error).message}); downloading full file…`, "warn");
      loadStatus.show(`Downloading ${name}…`);
      const blob = await fetchWholeVideo(source, name);
      const file = new File([blob], name, { type: blob.type || "video/mp4" });
      return { backend: await requireFirstFrame(await openLocalBackend(file, name), name), file };
    }
  }
  return { backend: await requireFirstFrame(await openLocalBackend(source, name), name), file: source };
}

/**
 * Where a video that would not open says so.
 *
 * There are two places it can be said, and the one to use is wherever the video was asked for. The
 * stage answers for a URL and a dropped file, which is what the picker above it opened; the browse
 * pane answers for a video picked out of a list, since that list is what is being read at the time
 * and the pane goes on standing whether or not another video is already playing behind it.
 *
 * What must not happen is both at once. Every attempt starts by clearing the pair (see
 * {@link clearLoadMessages}), so a refusal is never read beside the one before it.
 */
type LoadFailureReport = (name: string, message: string) => void;

/** The refusal's first line, the same wherever the rest of it is set out. */
function failureHeadline(name: string): string {
  return `${name} cannot be opened.`;
}

/** Says so on the stage. Only where there is no video on it: with one loaded the stage is the
 * picture, and a line written under it would be written where nobody is looking. */
const stageFailure: LoadFailureReport = (name, message) => {
  if (state.backend) return;
  setMessage(els.emptyStage, `${failureHeadline(name)}${PARAGRAPH}${message}`, APP_LINKS);
};

/** Says so in the browse pane, for a video picked out of it. */
const browseFailure: LoadFailureReport = (name, message) => {
  browseSay(`${failureHeadline(name)}${PARAGRAPH}${message}`, "err");
};

/** Takes down whatever the last attempt left behind, on both surfaces. Called as an attempt
 * begins, so the two can never be on screen together. */
function clearLoadMessages(): void {
  browseSay("");
  if (!state.backend) els.emptyStage.textContent = EMPTY_STAGE_DEFAULT;
}

async function loadVideo(
  source: File | string,
  name: string,
  url: string | null = null,
  report: LoadFailureReport = stageFailure,
  /** Where in the archive it was opened from, when it was — see AppState.sourceArchive. */
  archive: ArchiveSource | null = null,
): Promise<void> {
  stopPlay();
  clearLoadMessages();
  log(`Loading video: ${name}…`);
  // Raised before the first await, and lowered once there is a frame on the stage — or an error in
  // the console — so the wait is never unaccounted for.
  loadStatus.show(`Loading ${name}…`, pickedFrom(source, name));
  // Opening a video is not all waiting on a network: a container index is parsed on this thread, and
  // for a large local file that is long enough to be noticed as the page not answering. The frame
  // handed back here is the one the line above is drawn in, so it is on screen before any of that
  // starts rather than arriving with the video it was meant to cover for.
  await nextPaint();
  try {
    // A file that reaches here already looks like it should play — its container streams, or it
    // arrived as bytes the picker accepted — so nothing beyond this point is expected to run long.
    // A hang inside it (a stalled request, a decoder waiting on a frame that never comes) would
    // otherwise look exactly like an ordinary wait for as long as nobody cuts it off.
    const { backend, file } = await withTimeout(openVideoBackend(source, name), LOAD_TIMEOUT_MS, loadTimeoutRefusal(name));
    // Dropping the reference to the outgoing backend frees neither its decoded frames — ImageBitmaps
    // hold memory the collector does not account for — nor, for a streamed URL, the requests its
    // source still has in flight. Closed only once the replacement is open, so a load that fails
    // leaves the video that was on screen playable.
    state.backend?.close?.();
    state.curBitmap = null;
    state.backend = backend;
    state.frameOrder = await buildFrameOrder(backend);
    const shape = backend.shape ?? [];
    state.height = shape[1] || backend.height || 0;
    state.width = shape[2] || backend.width || 0;
    state.totalFrames = backend.numFrames ?? shape.at(0) ?? 0;
    state.fps = backend.fps || 30;
    // A new recording opens at its start, like the playhead below it.
    state.viewCenter = 0;
    state.sourceName = name;
    state.sourceUrl = url;
    state.sourceArchive = archive;
    // loadVideo fully owns source state: this is either the dropped File, the one the stream
    // fallback materialized, or null for a live-streamed URL — never a previous load's leftover.
    state.sourceFile = file;
    sourceGeneration++;
    clearDeliveryOutcomes();
    // A recording opens with a snippet already marked out on it rather than with bare handles and a
    // range that silently means all of it, and with the playhead on that snippet's first frame
    // rather than back at the start of the recording — see resetSelection.
    resetSelection();
    // Blur areas are placed in the pixels of the video that was on screen when they were drawn.
    // Another recording puts something else under them, so they are dropped rather than carried
    // over onto a frame nobody has looked at.
    clearBlurRegions();
    prefetched = null;
    prefetchInFlight = false;
    els.view.width = state.width;
    els.view.height = state.height;
    els.emptyStage.style.display = "none";
    els.view.style.display = "block";
    els.overlayInfo.style.display = "block";
    enablePlayer(true);
    // The radius controls are bounded by the frame, so they only mean anything once one is loaded.
    resetBlurRadius();
    log(`Loaded ${state.width}×${state.height}, ${state.totalFrames} frames @ ${state.fps.toFixed(2)} fps`, "ok");
    recheckPose();
    // Forced, since resetSelection has already put state.cur where the playhead belongs and there is
    // no frame on the stage yet to match it; and never as a shift-extend, since nothing was scrubbed
    // over — a key held down while a video loaded is not a gesture on the marks it arrives with.
    await seek(state.cur, true, false);
    updateSelUI();
    // The card comes down a frame after the picture goes up, not in the same one. Drawing into the
    // canvas and hiding the card land together otherwise, and whichever the compositor takes first
    // decides whether the stage is briefly bare with nothing left on the page to say why.
    await nextPaint();
  } catch (e) {
    log(`Video error: ${(e as Error).message}`, "err");
    console.error(e);
    // A load that failed has to say so where it was asked for: otherwise the indicator comes down
    // and the page goes back to inviting a file as though nothing had happened.
    // Set through linkify because a refusal names where the file can be re-encoded, and a URL
    // nobody can click is only half an answer.
    report(name, friendlyError(e));
  } finally {
    loadStatus.hide();
  }
}

// ============================================================
// SLP loading
// ============================================================
/** The open video's own metadata, for comparison against a `.slp`'s. Null when none is open. */
function loadedVideoMeta(): LoadedVideoMeta | null {
  if (!state.backend) return null;
  return { name: state.sourceName, frames: state.totalFrames, width: state.width, height: state.height, fps: state.fps };
}

/** Drops whatever pose file was loaded, leaving the card free to report why. */
function clearPose(): void {
  state.pose = null;
  state.slpFile = null;
  state.poseUrl = null;
  state.slpName = null;
  state.slpKind = null;
  state.slpMeta = null;
  poseGeneration++;
  clearDeliveryOutcomes();
  els.slpStatus.hidden = true;
  // Nothing is loaded, so there is no pair left to caution anyone about.
  els.slpWarning.hidden = true;
  syncUrl();
}

/** Fills one of the card's notice blocks with a headline and a line per reason. */
function fillNotice(title: HTMLParagraphElement, list: HTMLUListElement, headline: string, reasons: string[]): void {
  title.textContent = headline;
  list.replaceChildren(
    ...reasons.map((reason) => {
      const li = document.createElement("li");
      li.textContent = reason;
      return li;
    }),
  );
}

/** Puts the card into its refused state: nothing loaded, and the reasons why. */
function showSlpError(headline: string, reasons: string[]): void {
  clearPose();
  fillNotice(els.slpErrorTitle, els.slpErrorList, headline, reasons);
  els.slpError.hidden = false;
  renderFrame();
}

/** Flags differences that did not stop the `.slp` loading — the pose is on screen, and this says
 * what about the pair is worth a second look before anything is extracted from it. */
function showSlpWarnings(name: string, video: LoadedVideoMeta, warnings: string[]): void {
  els.slpWarning.hidden = warnings.length === 0;
  if (!warnings.length) return;
  fillNotice(els.slpWarningTitle, els.slpWarningList, `"${name}" may not be the annotations for "${video.name}".`, warnings);
  for (const w of warnings) log(`SLP/video difference: ${w}`, "warn");
}

/** Refuses a pose file that describes a different recording, naming every field that disagrees: a
 * pose overlaid on the wrong video is wrong in a way that still looks like an annotation. */
function rejectSlp(name: string, kind: PoseFileKind, video: LoadedVideoMeta, mismatches: MetadataMismatch[]): void {
  showSlpError(
    `"${name}" does not match "${video.name}".`,
    mismatches.map((m) => `${m.field}: ${m.slp} in the ${kind}, ${m.video} in the video.`),
  );
  log(`SLP mismatch: ${name} does not match ${video.name} (${mismatches.map((m) => m.field.toLowerCase()).join(", ")})`, "err");
}

/** Re-runs the comparison after a video is opened under an already-loaded pose file — the pair can
 * be assembled in either order, and swapping the video out is just as able to break the match. */
function recheckPose(): void {
  // Any notice still on the card was raised against the video that just went away, so both are
  // cleared before the new pairing is judged on its own terms.
  els.slpError.hidden = true;
  els.slpWarning.hidden = true;
  const video = loadedVideoMeta();
  if (!state.slpMeta || !state.slpName || !state.slpKind || !video) return;
  const mismatches = slpVideoMismatches(state.slpMeta, video);
  if (mismatches.length) {
    rejectSlp(state.slpName, state.slpKind, video, mismatches);
    return;
  }
  // An `.nwb`'s frame indices can only be trusted against a known video length, so the alignment
  // that could not run at load time runs now. It is a no-op on anything already aligned.
  if (state.pose) {
    const aligned = alignDenseFrames(state.pose, state.slpMeta.seriesLength, video.frames);
    if (aligned !== state.pose) {
      state.pose = aligned;
      poseGeneration++;
      clearDeliveryOutcomes();
      log("NWB pose samples re-indexed onto the video's frames", "warn");
    }
  }
  showSlpWarnings(state.slpName, video, slpVideoWarnings(state.slpMeta, video, state.slpKind));
}

/** Which reader a pose file goes to. NWB is HDF5 underneath just as a `.slp` is, so nothing but the
 * extension separates them here; `.h5`/`.hdf5` stay with SLEAP, where they have always meant a
 * `.slp` under a different name. */
function poseFileKind(name: string): PoseFileKind {
  return /\.nwb$/i.test(name) ? ".nwb" : ".slp";
}

/** An `.nwb`'s bytes, whether it was dropped in or named by a URL. Unlike the `.slp` path — where
 * sleap-io.js streams a remote file over range requests — the whole file is pulled down, because
 * the labels and the pose series length are read from it separately and both readers want the
 * bytes; fetching once and handing the same buffer to each is cheaper than opening it twice. */
async function nwbBytes(source: File | string): Promise<ArrayBuffer> {
  if (source instanceof File) return source.arrayBuffer();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

async function loadPoseFile(source: File | string, name: string): Promise<void> {
  // A pose file can arrive via the main dropzone or a URL param while the annotations step is still
  // toggled off — reveal the step so the load has somewhere visible to land.
  enableSlpStep();
  const kind = poseFileKind(name);
  log(`Parsing ${kind === ".nwb" ? "NWB" : "SLP"}: ${name}…`);
  try {
    let labels: SleapLabels;
    // Only ndx-pose predictions have a series to measure, and only they need it: everything else
    // records the video's shape where lib/match.ts can already find it.
    let seriesLength: number | null = null;
    if (kind === ".nwb") {
      const bytes = await nwbBytes(source);
      labels = await sio.loadNwb(bytes);
      seriesLength = await probeNwbSeriesLength(bytes);
    } else {
      labels = await sio.loadSlp(source, { openVideos: false });
    }
    const meta = slpSourceMeta(labels, seriesLength);
    const video = loadedVideoMeta();
    // Checked before anything is kept, so a mismatched file never reaches the overlay, the
    // annotations sidecar or an upload. With no video open yet there is nothing to check against;
    // loadVideo() runs the same comparison once one is.
    if (video) {
      const mismatches = slpVideoMismatches(meta, video);
      if (mismatches.length) {
        rejectSlp(name, kind, video, mismatches);
        return;
      }
    }
    const parsed = labelsToPose(labels);
    // With no video open the series length has nothing to be dense against, so this waits for
    // recheckPose() to run it once one is.
    state.pose = alignDenseFrames(parsed, seriesLength, video?.frames ?? null);
    if (state.pose !== parsed) log("NWB pose samples re-indexed onto the video's frames", "warn");
    state.slpMeta = meta;
    state.slpName = name;
    state.slpKind = kind;
    // Only after a successful parse: a file this app could not read is not one to hand to the
    // archive.
    state.slpFile = source instanceof File ? source : null;
    state.poseUrl = source instanceof File ? null : source;
    poseGeneration++;
    clearDeliveryOutcomes();
    const nFrames = state.pose.byFrame.size;
    log(`Pose loaded: ${state.pose.skeleton.nodes.length} nodes, ${state.pose.tracks.length} tracks, ${nFrames} labeled frames`, "ok");
    els.slpBadge.textContent = `${nFrames} frames`;
    els.slpBadge.className = "badge ok";
    els.slpError.hidden = true;
    els.slpStatus.hidden = false;
    // Raised after the load rather than instead of it: the pose is on screen either way.
    if (video) showSlpWarnings(name, video, slpVideoWarnings(meta, video, kind));
    else els.slpWarning.hidden = true;
    renderFrame();
    syncUrl();
  } catch (e) {
    // A file that could not be read has to say so on the card too: the console is not where someone
    // dropping a pose file is looking, and a silent failure is indistinguishable from a check that
    // never ran.
    const expected = kind === ".nwb" ? "an NWB pose file" : "a SLEAP labels file";
    showSlpError(`"${name}" could not be read as ${expected}.`, [friendlyError(e)]);
    log(`SLP error: ${(e as Error).message}`, "err");
    console.error(e);
  }
}

// ============================================================
// Rendering
// ============================================================
function renderFrame(): void {
  if (!state.curBitmap) return;
  ctx.clearRect(0, 0, els.view.width, els.view.height);
  drawVideoFrame(state.curBitmap, ctx, state.width, state.height);
  // On the player for the same reason it is in the extraction: what is on screen is what will be
  // written, so a blur area is judged against the pixels it actually hides rather than a ring
  // drawn over an unobscured face.
  paintBlurRegions(ctx, state.blurRegions, state.width, state.height);
  if (state.pose && els.slpToggle.checked && els.showPose.checked)
    drawPose(ctx, state.pose.byFrame.get(state.cur), state.pose.skeleton, state.width);
  els.overlayInfo.textContent = `frame ${state.cur} / ${state.totalFrames - 1}  ·  ${fmtTime(state.cur, state.fps)}`;
}

// ============================================================
// Blur tool
// ============================================================
// Circular areas placed over anything that identifies a subject. The blurred pixels themselves are
// painted into the canvas by renderFrame above and into every file by lib/extract.ts; everything
// here is the rings over the top of the picture, the controls beside it, and the bookkeeping that
// keeps the two in step. The tool is revealed by the human-subjects gate further down — or by an
// area already existing, which must stay removable however the destination changed underneath it.

// Whether the next click on the picture places a new area, rather than landing on it and doing
// nothing.
let blurArmed = false;
// Which area the radius control and Remove act on: an index into state.blurRegions, or null for
// none. Focus and selection are the same thing, so tabbing between rings moves the controls with it.
let selectedBlur: number | null = null;
// The radius a newly placed area starts at, carried between placements so covering four faces at
// one size is four clicks rather than four resizes.
let newBlurRadius = MIN_BLUR_RADIUS;
// The area being dragged, with the grab point's offset from its centre, so a ring picked up by its
// edge does not jump its centre under the pointer.
let blurDrag: { index: number; dx: number; dy: number } | null = null;

/** The area at `index`, or null when the index no longer points at one: a ring reads its index back
 * out of the DOM, and the area behind it may have been removed since the event was bound. */
function blurRegionAt(index: number | null): BlurRegion | null {
  if (index === null || index < 0 || index >= state.blurRegions.length) return null;
  return state.blurRegions[index];
}

/** How large an area is allowed to be, which only means anything once a video is loaded — the
 * bounds are the frame. The fallback matches the markup's own, for the disabled controls. */
function blurRadiusBounds(): { min: number; max: number } {
  return { min: MIN_BLUR_RADIUS, max: state.backend ? maxBlurRadius(state.width, state.height) : 100 };
}

/** Where a pointer is in source-video pixels. The canvas is drawn at whatever size the layout gives
 * it, and letterboxed inside that box when the two are different shapes, so every screen coordinate
 * the tool reads comes through the same fit the rings are placed by. */
function sourcePoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = els.view.getBoundingClientRect();
  const fit = frameFit(rect.width, rect.height, state.width, state.height);
  if (!fit.scale) return { x: 0, y: 0 };
  return { x: (clientX - rect.left - fit.offsetX) / fit.scale, y: (clientY - rect.top - fit.offsetY) / fit.scale };
}

/** Sizes the controls to the video just loaded. */
function resetBlurRadius(): void {
  newBlurRadius = defaultBlurRadius(state.width, state.height);
  renderBlurTools();
}

/** Every mutation of the areas funnels through here: the pixels change, so the picture is redrawn,
 * anything already extracted stops describing what is on screen, and the rings follow. */
function blurChanged(): void {
  blurGeneration++;
  clearDeliveryOutcomes();
  renderFrame();
  renderBlurTools();
  updateDeliveryGate();
}

/** Drops every area — because Clear all was pressed, or because a different video is now under
 * them and their coordinates no longer point at anything anybody has looked at. */
function clearBlurRegions(): void {
  setBlurArmed(false);
  if (!state.blurRegions.length) return;
  state.blurRegions = [];
  selectedBlur = null;
  blurChanged();
}

function setBlurArmed(armed: boolean): void {
  blurArmed = armed && state.backend !== null && !deliveryBusy;
  els.stage.classList.toggle("placing", blurArmed);
  els.blurAddBtn.classList.toggle("armed", blurArmed);
  els.blurAddBtn.setAttribute("aria-pressed", String(blurArmed));
  renderBlurHint();
}

function addBlurRegion(x: number, y: number): void {
  if (!state.backend) return;
  state.blurRegions.push(clampRegion({ x, y, radius: newBlurRadius }, state.width, state.height));
  selectedBlur = state.blurRegions.length - 1;
  setBlurArmed(false);
  blurChanged();
  // Focus follows the new ring, so it can be nudged into place from the keyboard straight away.
  (els.blurLayer.children[selectedBlur] as HTMLElement | undefined)?.focus();
}

function removeBlurRegion(index: number): void {
  if (!blurRegionAt(index)) return;
  state.blurRegions.splice(index, 1);
  selectedBlur = state.blurRegions.length ? Math.min(index, state.blurRegions.length - 1) : null;
  blurChanged();
  // The ring that had focus is gone; hand it to its neighbour, or back to the button that makes new
  // ones, rather than letting it fall to the top of the document.
  const next = selectedBlur === null ? els.blurAddBtn : (els.blurLayer.children[selectedBlur] as HTMLElement);
  next.focus();
}

/** Applies a radius to the selected area, and to the next one placed. */
function setBlurRadius(radius: number): void {
  const { min, max } = blurRadiusBounds();
  newBlurRadius = Math.max(min, Math.min(max, Math.round(radius)));
  const selected = blurRegionAt(selectedBlur);
  if (selectedBlur === null || !selected) {
    renderBlurTools();
    return;
  }
  state.blurRegions[selectedBlur] = clampRegion({ ...selected, radius: newBlurRadius }, state.width, state.height);
  blurChanged();
}

function moveBlurRegion(index: number, x: number, y: number): void {
  const region = blurRegionAt(index);
  if (!region) return;
  const next = clampRegion({ ...region, x, y }, state.width, state.height);
  if (next.x === region.x && next.y === region.y) return;
  state.blurRegions[index] = next;
  blurChanged();
}

/** True while the tool belongs on screen: the destination is a dataset flagged as holding
 * human-subjects data, or an area placed while it was is still there to be found and removed. */
function blurToolAvailable(): boolean {
  return state.backend !== null && (humanSubjectsFlagged() || state.blurRegions.length > 0);
}

function renderBlurHint(): void {
  const count = state.blurRegions.length;
  els.blurHint.textContent = blurArmed
    ? "Click the picture to place a blur area there."
    : count === 0
      ? "Add a blur area and drag it over a face, a badge, or anything else identifying. Whatever it covers is blurred in every file this page produces."
      : `${count} blur area${count === 1 ? "" : "s"} — drag to move, arrow keys to nudge, + and − to resize. The blur is burned into the snippet, the frame and the pose overlay alike.`;
}

function renderBlurTools(): void {
  const available = blurToolAvailable();
  els.blurTools.hidden = !available;
  if (!available) setBlurArmed(false);
  const { min, max } = blurRadiusBounds();
  const radius = blurRegionAt(selectedBlur)?.radius ?? newBlurRadius;
  for (const input of [els.blurRadiusRange, els.blurRadiusValue]) {
    input.min = String(min);
    input.max = String(max);
    input.disabled = deliveryBusy;
    // Never while it is the field being dragged or typed into: rewriting a half-entered number
    // mid-keystroke makes it unusable, and the value is written back on commit anyway.
    if (document.activeElement !== input) input.value = String(radius);
  }
  els.blurAddBtn.disabled = !state.backend || deliveryBusy;
  els.blurRemoveBtn.disabled = selectedBlur === null || deliveryBusy;
  els.blurClearBtn.disabled = state.blurRegions.length === 0 || deliveryBusy;
  // An extraction reads the areas as it runs, so they are held still until it is done.
  els.blurLayer.classList.toggle("locked", deliveryBusy);
  syncBlurHandles();
  renderBlurHint();
}

/** Which area a ring stands for. Read from the DOM rather than closed over, so removing an area does
 * not leave every later ring pointing one past itself. */
function blurHandleIndex(handle: HTMLElement): number {
  return Array.prototype.indexOf.call(els.blurLayer.children, handle);
}

function createBlurHandle(): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "blur-handle";
  handle.tabIndex = 0;
  handle.setAttribute("role", "button");
  handle.addEventListener("focus", () => {
    selectedBlur = blurHandleIndex(handle);
    renderBlurTools();
  });
  handle.addEventListener("pointerdown", (e) => {
    const index = blurHandleIndex(handle);
    const region = blurRegionAt(index);
    if (!region || deliveryBusy) return;
    e.preventDefault();
    // Without this an armed click would also land on the picture and place a second area under the
    // one being grabbed.
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    handle.focus();
    const at = sourcePoint(e.clientX, e.clientY);
    blurDrag = { index, dx: region.x - at.x, dy: region.y - at.y };
  });
  handle.addEventListener("pointermove", (e) => {
    if (!blurDrag || !handle.hasPointerCapture(e.pointerId)) return;
    const at = sourcePoint(e.clientX, e.clientY);
    moveBlurRegion(blurDrag.index, at.x + blurDrag.dx, at.y + blurDrag.dy);
  });
  const release = (e: PointerEvent): void => {
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
    blurDrag = null;
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
  handle.addEventListener("keydown", (e) => {
    const index = blurHandleIndex(handle);
    const region = blurRegionAt(index);
    if (!region || deliveryBusy) return;
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") moveBlurRegion(index, region.x - step, region.y);
    else if (e.key === "ArrowRight") moveBlurRegion(index, region.x + step, region.y);
    else if (e.key === "ArrowUp") moveBlurRegion(index, region.x, region.y - step);
    else if (e.key === "ArrowDown") moveBlurRegion(index, region.x, region.y + step);
    else if (e.key === "+" || e.key === "=") setBlurRadius(region.radius + step);
    else if (e.key === "-" || e.key === "_") setBlurRadius(region.radius - step);
    else if (e.key === "Delete" || e.key === "Backspace") removeBlurRegion(index);
    else return;
    e.preventDefault();
    // The window-level shortcut handler would otherwise read the same arrow key as a seek.
    e.stopPropagation();
  });
  return handle;
}

/** Reconciles the rings with the areas, reusing the elements already there: rebuilding them all on
 * every change would drop focus out of the one being nudged, and out of the one being dragged. */
function syncBlurHandles(): void {
  while (els.blurLayer.children.length > state.blurRegions.length) els.blurLayer.lastElementChild!.remove();
  while (els.blurLayer.children.length < state.blurRegions.length) els.blurLayer.append(createBlurHandle());
  positionBlurHandles();
}

/** Lays the rings over the canvas. They are positioned against the stage in display pixels, through
 * the same fit that maps a pointer back to the frame — the canvas box is not always the video's
 * shape, and a ring placed by the box's width alone would sit off the circle it stands for, in a
 * shape the circle is not. This re-runs whenever the canvas is resized. */
function positionBlurHandles(): void {
  els.blurLayer.hidden = state.blurRegions.length === 0;
  const fit = frameFit(els.view.clientWidth, els.view.clientHeight, state.width, state.height);
  const left = els.view.offsetLeft + fit.offsetX;
  const top = els.view.offsetTop + fit.offsetY;
  state.blurRegions.forEach((region, i) => {
    const handle = els.blurLayer.children[i] as HTMLElement | undefined;
    if (!handle) return;
    handle.style.left = `${left + (region.x - region.radius) * fit.scale}px`;
    handle.style.top = `${top + (region.y - region.radius) * fit.scale}px`;
    handle.style.width = `${region.radius * 2 * fit.scale}px`;
    handle.style.height = `${region.radius * 2 * fit.scale}px`;
    handle.classList.toggle("selected", selectedBlur === i);
    handle.setAttribute("aria-label", `Blur area ${i + 1} of ${state.blurRegions.length}, radius ${region.radius} pixels`);
  });
}

els.blurAddBtn.addEventListener("click", () => setBlurArmed(!blurArmed));
els.view.addEventListener("click", (e) => {
  if (!blurArmed) return;
  const at = sourcePoint(e.clientX, e.clientY);
  addBlurRegion(at.x, at.y);
});
els.blurRemoveBtn.addEventListener("click", () => {
  if (selectedBlur !== null) removeBlurRegion(selectedBlur);
});
els.blurClearBtn.addEventListener("click", clearBlurRegions);
// The slider and the number field are two views of one radius: the slider for finding a size against
// the picture, the field for saying one exactly.
for (const input of [els.blurRadiusRange, els.blurRadiusValue]) {
  input.addEventListener("input", () => {
    const typed = parseInt(input.value, 10);
    if (Number.isFinite(typed)) setBlurRadius(typed);
  });
  // Writes back whatever was clamped, once the entry has landed.
  input.addEventListener("change", renderBlurTools);
}
new ResizeObserver(positionBlurHandles).observe(els.view);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && blurArmed) setBlurArmed(false);
});

// ============================================================
// Transport / seeking
// ============================================================
let seeking = false;
let pendingSeek: number | null = null;

// Read-ahead bookkeeping. sleap-io.js's getFrame() awaits any in-flight decodeRange before it will
// serve even an already-cached frame, so asking for a fresh window on every seek made each rendered
// frame wait on a whole range decode — playback crawled and stalled for seconds at a time while the
// playhead kept advancing. Ask once per window instead, and never while a request is outstanding.
//
// Measured on a 1920x1080 clip (software decode), distinct frames rendered per second and the worst
// stall: a window per seek 1.8fps/1900ms, one per window 5.6fps/1000ms, and skipping it during
// playback (below) 5.4fps/350ms. A smaller window is worse, not better — 8 frames re-arms so often
// that a decode is almost always in flight, back down to 2.2fps. Playback is sequential, which is
// the access pattern the backend's own decoder already handles well; scrubbing is what benefits from
// reading ahead.
const PREFETCH_AHEAD = 30;
// Re-arm this far before the window's end, so the next range is in flight before it is needed.
const PREFETCH_MARGIN = 10;
let prefetched: { lo: number; hi: number } | null = null;
let prefetchInFlight = false;

function schedulePrefetch(target: number): void {
  const backend = state.backend;
  if (!backend || typeof backend.prefetch !== "function" || prefetchInFlight) return;
  if (prefetched && target >= prefetched.lo && target + PREFETCH_MARGIN <= prefetched.hi) return;
  const hi = Math.min(state.totalFrames - 1, target + PREFETCH_AHEAD);
  if (hi <= target) return;
  // Decode order may be locally reordered (B-frames), so bound the range by min/max.
  const a = decodeIndex(state.frameOrder, target);
  const b = decodeIndex(state.frameOrder, hi);
  prefetched = { lo: target, hi };
  prefetchInFlight = true;
  backend
    .prefetch(Math.min(a, b), Math.max(a, b))
    .catch(() => {})
    .finally(() => {
      prefetchInFlight = false;
    });
}
// How long a frame may be waited on before the stage says it is being waited on. Long enough that
// the frames served straight from the decoded-frame cache — most of them — never flash anything,
// short enough that a seek into a stretch that has to come over the network says so before the
// player looks stuck on the frame it was already showing.
const FRAME_WAIT_MS = 250;

/** The seek in flight, for a call that queued its frame behind it to wait on. Null between runs. */
let seekRun: Promise<void> | null = null;

// Shift-held seeking extends the selection to cover the frames scrubbed over (video mode only).
let shiftHeld = false;
let shiftAnchor: number | null = null;

/** `extend` is what makes a shift-held seek grow the range; a seek the app makes on its own behalf
 * (settling a panned window) passes false, since nothing was scrubbed over to include. */
async function seek(frame: number, force = false, extend = true): Promise<void> {
  frame = Math.max(0, Math.min(state.totalFrames - 1, frame | 0));
  if (extend && shiftHeld && state.mode === "video") growSelection(frame);
  if (frame === state.cur && !force && state.curBitmap) return;
  state.cur = frame;
  followPlayhead();
  if (seeking) {
    pendingSeek = frame;
    updateSelUI();
    // Handed to the run already going, which drains this before it ends (see the loop below) — and
    // waited on rather than left to it, so that awaiting a seek always means the frame asked for is
    // the one on screen. A load takes its indicator down on the strength of that; returning here
    // while nothing had been drawn yet took the indicator down over a blank stage.
    await seekRun;
    return;
  }
  seeking = true;
  // A frame the cache already holds is served in the time it takes to draw it, and one that has to
  // be decoded off a stream is a network round trip — the same call, with three orders of magnitude
  // between them. Rather than guess which this is, say so only once it has taken long enough to be
  // worth saying (see ui/busyStatus.ts), which leaves ordinary scrubbing untouched.
  stageStatus.showAfter(FRAME_WAIT_MS, "Loading frame…");
  const run = (async () => {
    do {
      const target = pendingSeek == null ? frame : pendingSeek;
      pendingSeek = null;
      if (!state.backend) break;
      try {
        const f = await state.backend.getFrame(decodeIndex(state.frameOrder, target));
        if (f) {
          state.curBitmap = f;
          state.cur = target;
          renderFrame();
        }
        if (!state.playing) schedulePrefetch(target);
      } catch (e) {
        log(`Seek error: ${(e as Error).message}`, "err");
      }
      // A concurrent call to seek() (this is re-entrant: the loop below awaits, and another
      // invocation can run and set pendingSeek during that await) may have queued a newer target
      // while this iteration's getFrame() was in flight — TS's flow analysis only sees this
      // function's own literal assignments and can't account for that, hence the cast.
    } while ((pendingSeek as number | null) !== null);
  })();
  seekRun = run;
  try {
    await run;
  } finally {
    stageStatus.hide();
    seeking = false;
    seekRun = null;
  }
  updateSelUI();
}

let rafId: number | null = null;
let lastT = 0;
let accum = 0;
function playLoop(t: number): void {
  if (!state.playing) return;
  if (!lastT) lastT = t;
  const dt = (t - lastT) / 1000;
  lastT = t;
  accum += dt * state.fps * state.speed;
  if (accum >= 1) {
    const step = Math.floor(accum);
    accum -= step;
    let next = state.cur + step;
    // Playback loops over the marked range in snippet mode. Frame mode keeps those marks (so
    // switching back restores them) but ignores them here — its selection is the playhead, and
    // penning playback inside a range nothing on screen mentions would look like a stuck player.
    const [lo, hi] = state.mode === "video" ? selRange() : [0, state.totalFrames - 1];
    // Wrapping on either side, not just the far end: a playhead left ahead of In would otherwise
    // play the whole run-up to the snippet before the first loop brought it inside.
    if (next > hi || next < lo) next = lo;
    void seek(next);
  }
  rafId = requestAnimationFrame(playLoop);
}
function startPlay(): void {
  if (state.playing || !state.backend) return;
  // Start inside the snippet rather than wherever the playhead was left: the handles are dragged
  // without moving it, so pressing play on a fresh range would otherwise begin outside the band.
  if (state.mode === "video") {
    const [lo, hi] = selRange();
    if (state.cur < lo || state.cur > hi) void seek(lo);
  }
  state.playing = true;
  lastT = 0;
  accum = 0;
  // Glyph only, so the label is the button's whole accessible name.
  els.btnPlay.innerHTML = "&#10073;&#10073;";
  els.btnPlay.setAttribute("aria-label", "Pause");
  rafId = requestAnimationFrame(playLoop);
}
function stopPlay(): void {
  state.playing = false;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
  els.btnPlay.innerHTML = "&#9654;";
  els.btnPlay.setAttribute("aria-label", "Play");
}
function togglePlay(): void {
  if (state.playing) stopPlay();
  else startPlay();
}

// ============================================================
// Selection
// ============================================================
/** The stretch that will be extracted. Both ends are set together or not at all — every route to a
 * range writes both — so the fallbacks below stand for "nothing marked yet", which is the whole
 * recording, rather than for one end of a half-marked one. */
function selRange(): [number, number] {
  const a = state.inF != null ? state.inF : 0;
  const b = state.outF != null ? state.outF : state.totalFrames - 1;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Puts the snippet's ends back where a freshly opened recording starts them — a fifth of the trim
 * track in from each of its ends (see lib/timeline.ts's defaultSelection) — and the playhead on the
 * In it just set. Both the opening range and what "Reset range" goes back to, so the two are the
 * same range and the player is never left in a state no load produces.
 *
 * The playhead comes along because the range is marked out for it. Left at the recording's start it
 * would sit a fifth of the track clear of a band it is not inside, showing a frame outside what
 * would be extracted, and the first press of play would jump away from it again.
 *
 * Silent about the UI and about decoding, since a load is still assembling both when it calls this.
 * Each caller ends with the seek onto state.cur its own moment needs, and the button below funnels
 * through selectionChanged as every other move of the marks does. */
function resetSelection(): void {
  const range = defaultSelection(view(), state.totalFrames);
  state.inF = range?.[0] ?? null;
  state.outF = range?.[1] ?? null;
  // Nothing to bound a snippet in means nothing to park on either: a recording that short is its own
  // first frame.
  state.cur = range?.[0] ?? 0;
}

// ============================================================
// The stretch of the recording the trim track covers
// ============================================================
/** The window's half-width for the loaded source, in frames. */
function halfFrames(): number {
  return windowHalfFrames(state.windowHalf, state.fps);
}
/** What the trim track currently spans: the whole video, or a window inside it once the video is
 * long enough that one track across all of it stops being a control anyone can aim. */
function view(): TimelineView {
  return windowFor(state.totalFrames, state.viewCenter, halfFrames());
}
/** Moves the window, carrying the playhead and the snippet's ends along with it.
 *
 * The markers hold their place on the track while the recording slides underneath, rather than the
 * window sliding over markers pinned to the video: a snippet of the right length can then be pushed
 * across a day to find the moment it belongs to, which is the way a range this short is found in a
 * recording this long. Everything moves by the window's own travel, so a pan that runs into either
 * end of the recording stops the whole assembly together instead of squashing the range against the
 * boundary.
 *
 * Cheap by design: it moves indices and decodes nothing, so it can run on every pointer move of a
 * drag across a day-long recording. The frame the playhead lands on is decoded once, by settleView,
 * when the drag ends. */
function setViewCenter(frame: number): void {
  const from = view().start;
  state.viewCenter = Math.max(0, Math.min(Math.max(0, state.totalFrames - 1), Math.round(frame)));
  const travel = view().start - from;
  if (travel !== 0) shiftMarkers(travel);
  buildRuler();
  updateSelUI();
}

/** Slides the playhead and either marked end by the window's own travel.
 *
 * A mark inside the window can never leave the recording this way: the window is itself clamped to
 * the video, so a mark at some offset into it lands inside wherever the window comes to rest. That
 * is what keeps the playhead exactly where the window left it, and keeps its two drawings — the
 * marker on the track and the hairline on the overview — reading the same frame.
 *
 * The clamp below therefore only ever bites on a mark that was already outside the window, which in
 * practice means an end still sitting on the video's own boundary because nothing has been marked
 * there yet. Such an end stays put while the rest travels, rather than holding the whole group
 * back: bounding the travel by the most constrained mark would freeze the playhead against a window
 * that kept moving, and the two drawings of it would then disagree. */
function shiftMarkers(travel: number): void {
  const last = Math.max(0, state.totalFrames - 1);
  const slide = (frame: number): number => Math.max(0, Math.min(last, frame + travel));
  state.cur = slide(state.cur);
  if (state.inF != null) state.inF = slide(state.inF);
  if (state.outF != null) state.outF = slide(state.outF);
}

/** Ends a pan of the window. The frames the markers have come to rest on are the snippet now, and
 * the playhead's frame is decoded — one decode for the whole drag, rather than one per pointer
 * move into a recording that is streamed a range request at a time. */
function settleView(): void {
  if (!state.backend) return;
  selectionChanged();
  // Already on state.cur, so only a forced seek will fetch it; and never as a shift-extend, since a
  // pan is not the shift-held scrub that grows a range.
  void seek(state.cur, true, false);
}
/** Keeps a playing head inside the window by paging the window forward, rather than letting
 * playback run out through the edge of a track that then stops showing where it is. */
function followPlayhead(): void {
  const { start, len } = view();
  if (state.cur >= start && state.cur < start + len) return;
  // Landing the playhead on the window's leading edge rather than at its centre: playback carries
  // on into fresh video instead of re-centring, and pages again when it reaches the end.
  state.viewCenter = state.cur + Math.floor(len / 2);
  // The gradations belong to the window, so they move with it; the markers and the overview are
  // redrawn by the updateSelUI() that every seek ends with.
  buildRuler();
}

// Grow the selection to include `target` (used while shift-seeking). Seeds from the shift-press
// frame when nothing is selected yet; only ever extends.
function growSelection(target: number): void {
  let lo: number, hi: number;
  if (state.inF == null && state.outF == null) {
    const anchor = shiftAnchor != null ? shiftAnchor : state.cur;
    lo = Math.min(anchor, target);
    hi = Math.max(anchor, target);
  } else {
    const a = state.inF != null ? state.inF : state.outF!;
    const b = state.outF != null ? state.outF : state.inF!;
    lo = Math.min(a, b, target);
    hi = Math.max(a, b, target);
  }
  if (lo === state.inF && hi === state.outF) return;
  state.inF = lo;
  state.outF = hi;
  selectionChanged();
}

/** Every in/out mutation funnels through here. Kept separate from updateSelUI(), which also runs on
 * every seek during playback, so the delivery card is only recomputed when the range really moves. */
function selectionChanged(): void {
  clearDeliveryOutcomes();
  updateSelUI();
  updateDeliveryGate();
}

/** Refreshes one of the editable readouts, unless it is the field being typed into — overwriting a
 * half-typed frame index mid-keystroke would make the field unusable. Its own commit handler puts it
 * back in step when the entry lands. */
function setFrameField(input: HTMLInputElement, value: number | null): void {
  if (document.activeElement === input) return;
  input.value = value == null ? "" : String(value);
}

/** Places one trim handle and tells assistive technology where it now sits. `unset` marks an end
 * that is only sitting at the video's own boundary because nothing has been marked there yet.
 *
 * A frame outside the stretch the track covers is pinned to the edge it left through and flagged,
 * rather than positioned off the end of a track that does not reach it. The value it reports stays
 * the frame itself: the marker's range is the whole video however little of it is on screen. */
function positionHandle(handle: HTMLElement, frame: number, at: TimelineView, unset: boolean): void {
  const t = fractionOf(at, frame);
  const outside = t < 0 || t > 1;
  handle.style.left = `${Math.max(0, Math.min(1, t)) * 100}%`;
  handle.classList.toggle("unset", unset);
  handle.classList.toggle("outside", outside);
  handle.setAttribute("aria-valuemax", String(Math.max(0, state.totalFrames - 1)));
  handle.setAttribute("aria-valuenow", String(frame));
  handle.setAttribute("aria-valuetext", outside ? `frame ${frame}, outside the visible range` : `frame ${frame}`);
}

function updateSelUI(): void {
  // Every move of the marks, the playhead, the selector mode or the loaded video ends up here, so
  // this is where the address is kept in step with them.
  syncUrl();
  setFrameField(els.curVal, state.backend ? state.cur : null);
  setFrameField(els.inVal, state.inF);
  setFrameField(els.outVal, state.outF);
  const at = view();
  const [lo, hi] = selRange();
  // The band is hidden by an inline style rather than by `.video-only`, which a live inline display
  // would outrank; the markers beside it carry no inline display, so the class is enough for them.
  const banded = state.mode === "video" && (state.inF != null || state.outF != null);
  els.selfill.style.display = banded ? "block" : "none";
  // Clipped to the track, since either end may sit outside the stretch it covers. The border on a
  // clipped side comes off with it (see #selfill.clip-l/-r): the band stops at the edge of the
  // window there, not at the end of the snippet.
  const a = Math.max(0, Math.min(1, fractionOf(at, lo)));
  const b = Math.max(0, Math.min(1, fractionOf(at, hi)));
  els.selfill.style.left = `${a * 100}%`;
  els.selfill.style.width = `${(b - a) * 100}%`;
  els.selfill.classList.toggle("clip-l", fractionOf(at, lo) < 0);
  els.selfill.classList.toggle("clip-r", fractionOf(at, hi) > 1);
  positionHandle(els.inHandle, lo, at, state.inF == null);
  positionHandle(els.outHandle, hi, at, state.outF == null);
  // The playhead draws its own line through the track, so positioning the marker positions both.
  positionHandle(els.playHandle, state.cur, at, false);
  updateOverview(at);
  // Frame mode's output name tracks the current frame, so the preview follows every seek.
  if (!deliveryBusy) {
    updateDeliveryPreview();
    // In frame mode the playhead *is* the selection, so moving it retires an outcome describing
    // where the last frame went. (A snippet's in/out points go through selectionChanged instead.)
    if (state.mode === "frame") clearDeliveryOutcomes();
  }
}

// ============================================================
// Trim track: the two range handles that bound a snippet
// ============================================================
// The playhead keeps the native range input above this track, so scrubbing and trimming never
// compete for the same drag: the top row only ever moves where you are looking, and this one only
// ever moves what will be extracted.

/** Lays out the time gradations under the track. Rebuilt whenever the stretch it covers changes,
 * since the spacing that suits a thirty-second clip is unreadable on a ten-minute one: the step is
 * chosen to land near six labelled divisions whatever the duration, then subdivided into fifths. */
function buildRuler(): void {
  els.selRuler.replaceChildren();
  if (!state.backend || state.totalFrames <= 1 || !state.fps) return;
  const at = view();
  const marks = document.createDocumentFragment();
  for (const { frame, seconds, major } of rulerMarks(at, state.fps)) {
    const t = fractionOf(at, frame);
    const position = `${t * 100}%`;
    const tick = document.createElement("div");
    tick.className = major ? "sel-tick major" : "sel-tick";
    tick.style.left = position;
    marks.append(tick);
    if (!major) continue;
    const label = document.createElement("span");
    // The outermost labels align inwards; centred, they would hang off the ends of the track.
    const edge = t < 0.02 ? " at-start" : t > 0.96 ? " at-end" : "";
    label.className = `sel-tick-label${edge}`;
    label.style.left = position;
    label.textContent = rulerLabel(seconds);
    marks.append(label);
  }
  els.selRuler.append(marks);
}

// ============================================================
// Overview: the whole recording, under the track that trims part of it
// ============================================================

/** Shows or hides the overview, and lays out its gradations for what it now spans. It arrives with
 * its width control, on the transport row, at the same length of recording: a width means nothing
 * without a window to apply it to, and a window means nothing without a width to set. */
function refreshOverview(): void {
  const windowed = !!state.backend && showsWindow(state.totalFrames, state.fps);
  els.overviewWrap.hidden = !windowed;
  els.windowGroup.hidden = !windowed;
  buildOverviewRuler();
}

/** Lays out the hour gradations under the overview bar. Depends on how wide the bar is, so it is
 * rebuilt on resize as well as on load. */
function buildOverviewRuler(): void {
  els.overRuler.replaceChildren();
  if (els.overviewWrap.hidden) return;
  const marks = document.createDocumentFragment();
  for (const { frame, hour, labelled } of hourMarks(state.totalFrames, state.fps, els.overBar.clientWidth)) {
    const t = frame / Math.max(1, state.totalFrames - 1);
    const position = `${Math.min(1, t) * 100}%`;
    const tick = document.createElement("div");
    tick.className = labelled ? "over-tick major" : "over-tick";
    tick.style.left = position;
    marks.append(tick);
    if (!labelled) continue;
    const label = document.createElement("span");
    const edge = t < 0.02 ? " at-start" : t > 0.97 ? " at-end" : "";
    label.className = `over-tick-label${edge}`;
    label.style.left = position;
    label.textContent = `${hour}:00`;
    marks.append(label);
  }
  els.overRuler.append(marks);
}

/** Draws the window, the snippet and the playhead onto the whole recording. */
function updateOverview(at: TimelineView): void {
  if (els.overviewWrap.hidden) return;
  const den = Math.max(1, state.totalFrames - 1);
  const pos = (frame: number) => `${Math.max(0, Math.min(1, frame / den)) * 100}%`;
  els.overWin.style.left = pos(at.start);
  // Spans the frames it covers, first to last, on the same scale the marks below are placed on: a
  // width taken over the frame count rather than the span between them would leave the band and the
  // playhead inside it disagreeing about where the window ends.
  els.overWin.style.width = `${(Math.max(0, at.len - 1) / den) * 100}%`;
  els.overBar.setAttribute("aria-valuemax", String(den));
  els.overBar.setAttribute("aria-valuenow", String(at.start));
  els.overBar.setAttribute("aria-valuetext", `frames ${at.start} to ${Math.min(den, at.start + at.len - 1)} of ${state.totalFrames}`);
  const marked = state.mode === "video" && (state.inF != null || state.outF != null);
  els.overSel.style.display = marked ? "block" : "none";
  if (marked) {
    const [lo, hi] = selRange();
    els.overSel.style.left = pos(lo);
    els.overSel.style.width = `${((hi - lo) / den) * 100}%`;
  }
  els.overPlay.style.left = pos(state.cur);
}

/** Which frame a page x-coordinate on the overview bar falls on. */
function overFrameAtClientX(clientX: number): number {
  const rect = els.overBar.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(t * Math.max(0, state.totalFrames - 1));
}

// Pressing the bar outside the window sends the window there — the quick way across a recording,
// and it takes the snippet with it, since the window and what it holds travel together. Pressing
// inside it keeps the grab's offset, so the window slides with the pointer instead of jumping its
// centre under it.
let overGrab: number | null = null;
els.overBar.addEventListener("pointerdown", (e) => {
  if (!state.backend) return;
  e.preventDefault();
  els.overBar.setPointerCapture(e.pointerId);
  els.overBar.classList.add("dragging");
  els.overBar.focus();
  stopPlay();
  const at = view();
  const frame = overFrameAtClientX(e.clientX);
  overGrab = frame >= at.start && frame < at.start + at.len ? state.viewCenter - frame : null;
  if (overGrab === null) setViewCenter(frame);
});
els.overBar.addEventListener("pointermove", (e) => {
  if (!els.overBar.hasPointerCapture(e.pointerId)) return;
  setViewCenter(overFrameAtClientX(e.clientX) + (overGrab ?? 0));
});
const releaseOverview = (e: PointerEvent): void => {
  if (!els.overBar.hasPointerCapture(e.pointerId)) return;
  els.overBar.releasePointerCapture(e.pointerId);
  els.overBar.classList.remove("dragging");
  overGrab = null;
  settleView();
};
els.overBar.addEventListener("pointerup", releaseOverview);
els.overBar.addEventListener("pointercancel", releaseOverview);
els.overBar.addEventListener("keydown", (e) => {
  if (!state.backend) return;
  const at = view();
  const last = Math.max(0, state.totalFrames - 1);
  // A minute, an hour, or the whole window: the three distances worth crossing on a bar that spans
  // a recording running for hours.
  const step = e.key === "PageUp" || e.key === "PageDown" ? at.len : Math.round(state.fps * (e.shiftKey ? 3600 : 60));
  const dir =
    e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "PageDown"
      ? -1
      : e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp"
        ? 1
        : 0;
  const next = dir ? state.viewCenter + dir * step : e.key === "Home" ? 0 : e.key === "End" ? last : null;
  if (next === null) return;
  e.preventDefault();
  // The window-level shortcut handler would otherwise read the same arrow key as a seek too.
  e.stopPropagation();
  stopPlay();
  setViewCenter(next);
  settleView();
});

// The gradations under the overview are thinned to what the bar is wide enough to hold, so a
// resized window needs them laid out again.
window.addEventListener("resize", buildOverviewRuler);

// How much of the recording the track covers. Re-centred on the playhead rather than kept where it
// was, so the frame being looked at stays on screen at the new scale instead of sliding off it —
// and so no seek is owed, since the playhead cannot end up outside a window centred on it.
wireSeg(els.windowSeg, (value) => {
  state.windowHalf = windowHalfSeconds(Number(value));
  state.viewCenter = state.cur;
  saveSettings();
  refreshOverview();
  buildRuler();
  updateSelUI();
});

/** Which frame a page x-coordinate falls on, across whatever stretch the track covers. */
function frameAtClientX(clientX: number): number {
  const rect = els.selbar.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return frameAt(view(), (clientX - rect.left) / rect.width, state.totalFrames);
}

/** Writes both ends at once, materializing whichever was still unmarked: once a handle has been
 * dragged the range is a real one, and a band with a "—" at one end of it reads as a bug. */
function setSelection(lo: number, hi: number): void {
  const last = Math.max(0, state.totalFrames - 1);
  const clamp = (frame: number) => Math.max(0, Math.min(last, Math.round(frame)));
  const nextIn = clamp(Math.min(lo, hi));
  const nextOut = clamp(Math.max(lo, hi));
  if (nextIn === state.inF && nextOut === state.outF) return;
  state.inF = nextIn;
  state.outF = nextOut;
  selectionChanged();
}

/** Moves one end to `frame`, stopping at the other rather than crossing it — a handle dragged past
 * its partner collapses the range instead of silently swapping the two.
 *
 * Moving one end also materializes the other, if nothing has been marked there yet, and it does so
 * at the edge of what the timeline covers rather than at the edge of the recording. On a whole-video
 * timeline those are the same frame and this is what it has always done; on a windowed one the
 * video's end is hours past the right of the track, and seeding from it would turn the first drag of
 * a marker into a snippet running from here to the end of the day. */
function moveHandle(which: "in" | "out", frame: number): void {
  const at = view();
  const lo = state.inF ?? at.start;
  const hi = state.outF ?? at.start + at.len - 1;
  if (which === "in") setSelection(Math.min(frame, hi), hi);
  else setSelection(lo, Math.max(frame, lo));
}

/** Wires one marker: `read` is the frame it currently sits on, `move` is what dragging or arrowing it
 * does. All three markers on the track go through here, which is what makes the playhead behave like
 * the trim ends rather than like a second kind of control. */
function wireHandle(handle: HTMLElement, read: () => number, move: (frame: number) => void): void {
  handle.addEventListener("pointerdown", (e) => {
    if (!state.backend) return;
    // Deliberately does not move the handle yet: a press that lands off-centre would jump it, and
    // the first pointermove is close enough behind to feel immediate anyway.
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    handle.focus();
    stopPlay();
  });
  handle.addEventListener("pointermove", (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    move(frameAtClientX(e.clientX));
  });
  const release = (e: PointerEvent) => {
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
  handle.addEventListener("keydown", (e) => {
    if (!state.backend) return;
    const last = Math.max(0, state.totalFrames - 1);
    const at = read();
    const step = e.shiftKey ? 10 : 1;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? at - step
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? at + step
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    // The window-level shortcut handler would otherwise read the same arrow key as a seek too.
    e.stopPropagation();
    move(Math.max(0, Math.min(last, next)));
  });
}
wireHandle(
  els.inHandle,
  () => selRange()[0],
  (frame) => moveHandle("in", frame),
);
wireHandle(
  els.outHandle,
  () => selRange()[1],
  (frame) => moveHandle("out", frame),
);
wireHandle(
  els.playHandle,
  () => state.cur,
  (frame) => void seek(frame),
);

// Pressing the bare track moves the playhead there — the thing most often moved, and the only one of
// the three whose meaning does not depend on which mode the selector is in.
els.selbar.addEventListener("pointerdown", (e) => {
  if (!state.backend || e.target !== els.selbar) return;
  stopPlay();
  void seek(frameAtClientX(e.clientX));
});

// Dragging the band between the handles slides the whole range, keeping its length — the usual way
// to move a clip of the right duration onto the right moment.
let bandDrag: { grabbedAt: number; lo: number; hi: number; moved: boolean } | null = null;
els.selfill.addEventListener("pointerdown", (e) => {
  if (!state.backend) return;
  e.preventDefault();
  els.selfill.setPointerCapture(e.pointerId);
  const [lo, hi] = selRange();
  bandDrag = { grabbedAt: frameAtClientX(e.clientX), lo, hi, moved: false };
  stopPlay();
});
els.selfill.addEventListener("pointermove", (e) => {
  if (!bandDrag) return;
  const last = Math.max(0, state.totalFrames - 1);
  // Clamp the shift rather than either end, so sliding into a boundary stops the band there instead
  // of squashing it against the edge.
  const shift = Math.max(-bandDrag.lo, Math.min(last - bandDrag.hi, frameAtClientX(e.clientX) - bandDrag.grabbedAt));
  if (shift !== 0) bandDrag.moved = true;
  setSelection(bandDrag.lo + shift, bandDrag.hi + shift);
});
const releaseBand = (e: PointerEvent): void => {
  if (els.selfill.hasPointerCapture(e.pointerId)) els.selfill.releasePointerCapture(e.pointerId);
  // A press that never became a drag is a press on the track, and a press on the track means the
  // playhead. The band covers the middle of the track from the moment a video opens (see
  // resetSelection), so without this most of a seek control would quietly stop answering clicks.
  if (e.type === "pointerup" && bandDrag && !bandDrag.moved) void seek(bandDrag.grabbedAt);
  bandDrag = null;
};
els.selfill.addEventListener("pointerup", releaseBand);
els.selfill.addEventListener("pointercancel", releaseBand);

// ============================================================
// Frame-index entry
// ============================================================
/** Wires one readout as an entry field: `read` is what it shows, `apply` what a committed index
 * does. Anything unparseable or out of range is clamped or discarded, and the field is written back
 * either way, so what it shows is never a value the player is not actually on. */
function wireFrameField(input: HTMLInputElement, read: () => number | null, apply: (frame: number) => void): void {
  const refresh = (): void => {
    const value = read();
    input.value = value == null ? "" : String(value);
  };
  const commit = (): void => {
    const typed = parseInt(input.value.trim(), 10);
    if (Number.isFinite(typed)) apply(Math.max(0, Math.min(Math.max(0, state.totalFrames - 1), typed)));
    refresh();
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commit();
  });
  // A field left mid-edit and abandoned goes back to what the player is on.
  input.addEventListener("blur", refresh);
}

wireFrameField(
  els.curVal,
  () => (state.backend ? state.cur : null),
  (frame) => {
    stopPlay();
    void seek(frame);
  },
);
wireFrameField(
  els.inVal,
  () => state.inF,
  (frame) => moveHandle("in", frame),
);
wireFrameField(
  els.outVal,
  () => state.outF,
  (frame) => moveHandle("out", frame),
);

// ============================================================
// Selector mode (video vs frame)
// ============================================================
function setMode(mode: SelectorMode): void {
  state.mode = mode;
  clearDeliveryOutcomes();
  els.playerCard.classList.toggle("mode-frame", mode === "frame");
  // A frame selection is just the current frame, so frame mode hides the in/out controls — but it
  // deliberately leaves state.inF/outF alone. Looking at a single frame is a detour people take in
  // the middle of trimming a snippet, and throwing the range away on the way there means marking it
  // all over again on the way back.
  updateSelUI();
  // The delivery card names what it will produce (MP4 vs PNG), so it follows the selector mode.
  updateDeliveryGate();
}

// ============================================================
// UI wiring
// ============================================================
function enablePlayer(on: boolean): void {
  for (const b of [els.btnPrev, els.btnPlay, els.btnNext, els.btnClearSel]) b.disabled = !on;
  const last = String(Math.max(0, state.totalFrames - 1));
  for (const field of [els.inVal, els.curVal, els.outVal]) {
    field.disabled = !on;
    field.max = last;
  }
  // The markers are divs, so there is no `disabled` to set: aria-disabled carries the state (CSS
  // hides them on it), and dropping them out of the tab order keeps a dead control off the path.
  for (const handle of [els.inHandle, els.outHandle, els.playHandle]) {
    handle.setAttribute("aria-disabled", String(!on));
    handle.tabIndex = on ? 0 : -1;
  }
  refreshOverview();
  buildRuler();
  updateDeliveryGate();
}

// Segmented controls
function wireSeg(segEl: HTMLElement, apply: (value: string) => void): void {
  segEl.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      selectSeg(segEl, Object.values(b.dataset)[0]);
      const value = Object.values(b.dataset)[0];
      if (value != null) apply(value);
    });
  });
}

// Marks the button carrying `value` active — used by wireSeg and by programmatic switches
// (e.g. a ?url= param selecting the EMBER pane). aria-pressed carries the same state to screen
// readers, which otherwise hear an unremarkable row of buttons.
function selectSeg(segEl: HTMLElement, value: string | undefined): void {
  segEl.querySelectorAll("button").forEach((b) => {
    const active = Object.values(b.dataset)[0] === value;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
}

wireSeg(els.modeSeg, (v) => setMode(v as SelectorMode));

// Source toggle: local file (dropzone), browse EMBER, or stream a URL.
type SourceKind = "local" | "browse" | "ember";
function setSrcPane(src: SourceKind): void {
  els.localPane.hidden = src !== "local";
  els.browsePane.hidden = src !== "browse";
  els.emberPane.hidden = src !== "ember";
  // Reading the archive costs a bucket listing and a manifest per dataset, so nothing is read until
  // somebody actually opens the pane.
  if (src === "browse" && !browse) void refreshBrowse();
}
wireSeg(els.srcSeg, (v) => setSrcPane(v as SourceKind));

function loadFromEmberUrl(): void {
  const url = els.emberUrl.value.trim();
  if (!url) return;
  state.sourceFile = null;
  void loadVideo(url, nameFromUrl(url, "video.mp4"), url);
}
els.emberLoadBtn.addEventListener("click", loadFromEmberUrl);
els.emberUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadFromEmberUrl();
});

// ============================================================
// Browsing EMBER
// ============================================================
// Two halves, because an archive answers for a public dataset and an embargoed one in completely
// different ways. What is public is read straight out of EMBER's public S3 bucket (lib/archives.ts):
// one listing to learn which datasets exist, then the small `.jsonld` manifests each one publishes,
// with no sign-in and no call to the API. What is embargoed cannot be read that way at all — its
// manifests are listed in the bucket but refuse anonymous reads, which is the point — so a signed-in
// visitor's own datasets are asked of the API instead (lib/embargoed.ts) and merged into the same
// list.

/** Dataset rows put on the page at once, so a filter that matches everything cannot flood it. */
const BROWSE_ROW_LIMIT = 200;

interface BrowseState {
  datasets: ArchiveDandiset[];
  /** Titles of the *public* datasets, read from their manifests. An embargoed dataset carries its
   * own title from the API listing that found it. */
  names: Map<string, string>;
  /** Videos per dataset id. A dataset missing from the map has not had its file list read yet. */
  videos: Map<string, ArchiveVideo[]>;
  /** True once every dataset's file list has been read, which is what "with video only" needs. */
  swept: boolean;
  selected: string | null;
  /** The asset URL of the video last picked out of the list, so its row can be marked the way the
   * open dataset's is. Held by asset URL rather than by path, which only identifies a file within
   * its own dataset. */
  selectedVideo: string | null;
  /** Cancels this pass's outstanding reads when the pane is rebuilt (a sign-in, say). */
  abort: AbortController;
}

let browse: BrowseState | null = null;
/** Bumped on every rebuild, so a slow pass that has been superseded cannot paint over the one that
 * replaced it. */
let browseGeneration = 0;
/** Whether the list on screen was built signed in. What the pane can see changes with that and
 * with nothing else about the upload side, so it is the only thing that forces a rebuild. */
let browseSignedIn = false;
let browseFilterTimer: ReturnType<typeof setTimeout> | undefined;
/** The label and trailing-detail nodes of the rows currently on the page, so a name or a video
 * count arriving mid-sweep updates one row instead of rebuilding the list. */
const browseRowLabels = new Map<string, HTMLElement>();
const browseRowMeta = new Map<string, HTMLElement>();
/** The row buttons of the videos currently listed, by asset URL, so picking one can mark it where
 * it sits instead of rebuilding the list around it. */
const browseVideoRows = new Map<string, HTMLElement>();

/** The archive config the browse pane's API calls run under. Unlike currentConfig(), it is not
 * tied to the upload destination picker: which dataset is being read is passed per call. */
function browseConfig(): ArchiveConfig {
  return resolveConfig({ dandisetId: "", oauthAccessToken: oauthTokens?.accessToken });
}

function browseSay(message: string, cls: "" | "err" = ""): void {
  setMessage(els.browseStatus, message, APP_LINKS);
  els.browseStatus.classList.toggle("err", cls === "err");
}

/** Empties a list and replaces it with a single explanatory line. */
function browseEmpty(list: HTMLUListElement, message: string): void {
  list.replaceChildren();
  const li = document.createElement("li");
  const p = document.createElement("p");
  p.className = "browse-empty";
  p.textContent = message;
  li.append(p);
  list.append(li);
}

/** Empties the video list and says why, dropping the rows the selection mark tracks along with it. */
function browseVideosEmpty(message: string): void {
  browseVideoRows.clear();
  browseEmpty(els.browseVideos, message);
}

/** The title to show for a dataset, wherever it came from. */
function browseName(current: BrowseState, dandiset: ArchiveDandiset): string {
  return dandiset.name || current.names.get(dandiset.id) || "";
}

/** Reads the archive from scratch. Run when the pane is first opened and again whenever signing in
 * or out changes which datasets there are to see. */
async function refreshBrowse(): Promise<void> {
  const reopen = browse?.selected ?? null;
  // A rebuild changes what the pane can see, not what is on the stage, so the video picked out of it
  // stays picked and its row is marked again as soon as the list holding it is drawn.
  const picked = browse?.selectedVideo ?? null;
  browse?.abort.abort();
  browseSignedIn = isSignedIn();
  const generation = ++browseGeneration;
  const current: BrowseState = {
    datasets: [],
    names: loadCachedNames(),
    videos: new Map(),
    swept: false,
    selected: null,
    selectedVideo: picked,
    abort: new AbortController(),
  };
  browse = current;
  const signal = current.abort.signal;
  els.browseDandisetLink.hidden = true;
  els.browseVideoHeading.textContent = "Videos";
  browseVideosEmpty("Choose a dataset to see the videos in it.");
  els.browseDandisets.replaceChildren();

  // `?test&remote_listing=N` fakes the whole pane — the bucket listing, the manifests, and the
  // embargoed API listing all at once — so a live smoketest never reads the real archive. Marked
  // swept immediately, since there is nothing left to sweep: every dataset's video list is already
  // in hand.
  if (testInjection?.remoteListing !== null && testInjection?.remoteListing !== undefined) {
    const { datasets, videos } = fakeArchiveBrowse(testInjection.remoteListing);
    current.datasets = datasets;
    current.videos = videos;
    current.swept = true;
    renderDandisetList();
    browseSay("");
    return;
  }

  browseSay("Reading the EMBER archive listing…");

  try {
    if (oauthTokens) await ensureFreshOAuth();
    // Three independent reads, run together; only the bucket listing is allowed to fail the whole
    // pane. `publicIds` is what actually decides which bucket candidates are shown — see
    // lib/embargoed.ts's listPublicDandisetIds for why the bucket listing alone cannot be trusted
    // with that.
    const [candidates, owned, publicIds] = await Promise.all([
      listManifestObjects(signal).then(indexDandisets),
      listOwnedEmbargoed(signal),
      listPublicDandisetIds(browseConfig(), signal),
    ]);
    if (generation !== browseGeneration) return;
    const pub = candidates.filter((d) => publicIds.has(d.id));
    current.datasets = mergeDandisets(pub, owned);
    renderDandisetList();
    browseSay(browseCountLine(current));
    // A rebuild is a change of what can be seen, not a change of mind: whatever dataset was open
    // before is opened again, so signing in does not close it.
    const previous = reopen ? current.datasets.find((d) => d.id === reopen) : undefined;
    if (previous) void selectDandiset(previous);
    // Titles first, so the list is readable while the longer scan below runs against it.
    await hydrateNames(current, generation);
    await sweepVideos(current, generation);
  } catch (e) {
    if (signal.aborted) return;
    log(`Could not read the EMBER archive: ${(e as Error).message}`, "err");
    browseSay(`Could not read the EMBER archive: ${friendlyError(e)}`, "err");
  }
}

/** The datasets the signed-in visitor owns and nobody else can see. Signed out, there are none; a
 * failed lookup is reported and the public half of the pane carries on without them. */
async function listOwnedEmbargoed(signal: AbortSignal): Promise<ArchiveDandiset[]> {
  if (!oauthTokens) return [];
  const cfg = browseConfig();
  try {
    // Which datasets are the visitor's own is settled against their username, not against the
    // archive's `?user=me` filter — see listOwnedEmbargoedDandisets.
    currentUser ??= await fetchArchiveUser(cfg);
    return await listOwnedEmbargoedDandisets(cfg, currentUser?.username ?? "");
  } catch (e) {
    if (signal.aborted) throw e;
    log(`Could not list your embargoed datasets: ${(e as Error).message}`, "warn");
    return [];
  }
}

function browseCountLine(current: BrowseState): string {
  const mine = current.datasets.filter((d) => d.embargoed).length;
  const suffix = mine ? `, ${mine} of them embargoed and yours` : "";
  return `${current.datasets.length} EMBER datasets${suffix}.`;
}

/** Fills in public dataset titles, which is what makes the filter box match anything but a number. */
async function hydrateNames(current: BrowseState, generation: number): Promise<void> {
  const missing = current.datasets.filter((d) => !d.embargoed && !current.names.has(d.id));
  if (!missing.length) return;
  let done = 0;
  await hydrateDandisetNames(
    missing,
    (dandiset, name) => {
      if (generation !== browseGeneration) return;
      done++;
      if (name) {
        current.names.set(dandiset.id, name);
        const label = browseRowLabels.get(dandiset.id);
        if (label) label.textContent = name;
      }
      browseSay(`Naming datasets, ${done} of ${missing.length}…`);
    },
    current.abort.signal,
  );
  if (generation !== browseGeneration) return;
  saveCachedNames(current.names);
  browseSay(browseCountLine(current));
}

/** Every video in one dataset, asked of whichever side can answer for it. */
function readDandisetVideos(dandiset: ArchiveDandiset, signal?: AbortSignal): Promise<ArchiveVideo[]> {
  if (dandiset.embargoed) return listEmbargoedVideos(browseConfig(), dandiset.id, signal);
  return fetchDandisetVideos(dandiset, signal);
}

/**
 * Reads every dataset's file list, so the pane can show only the datasets that actually hold video.
 * Skipped when the public manifests are too large to read wholesale (see SWEEP_BUDGET_BYTES): a
 * dataset's file list is then read when it is opened instead.
 */
async function sweepVideos(current: BrowseState, generation: number): Promise<void> {
  if (!canSweep(current.datasets)) return;
  let done = 0;
  await sweepArchiveVideos(
    current.datasets,
    readDandisetVideos,
    (dandiset, videos) => {
      if (generation !== browseGeneration) return;
      done++;
      current.videos.set(dandiset.id, videos);
      const meta = browseRowMeta.get(dandiset.id);
      if (meta) meta.textContent = videoCountLabel(videos.length);
      browseSay(`Looking for video, ${done} of ${current.datasets.length} datasets…`);
    },
    current.abort.signal,
  );
  if (generation !== browseGeneration) return;
  current.swept = true;
  // Nothing left to report: the list itself is now the answer, and it holds only what can be
  // opened. The line stays clear until something is loading or has gone wrong.
  browseSay("");
  renderDandisetList();
}

function videoCountLabel(count: number): string {
  if (count === 0) return "no video";
  return count === 1 ? "1 video" : `${count} videos`;
}

/**
 * The datasets left visible. A dataset holding no video is never shown: this pane exists to pick a
 * video out of one, and a dataset that cannot offer one is a dead end. That is only knowable once
 * the sweep has read every file list, so before then — and on an archive too large to sweep at all —
 * every dataset is listed and a video-less one answers for itself when it is opened. Which datasets
 * are candidates at all (public vs. embargoed) is settled earlier, in refreshBrowse, before any of
 * this ever runs.
 */
function visibleDandisets(current: BrowseState): ArchiveDandiset[] {
  const query = els.browseFilter.value.trim().toLowerCase();
  return current.datasets.filter((d) => {
    const videos = current.videos.get(d.id);
    if (current.swept && !videos?.length) return false;
    if (!query) return true;
    if (d.id.includes(query)) return true;
    if (browseName(current, d).toLowerCase().includes(query)) return true;
    return (videos ?? []).some((v) => v.path.toLowerCase().includes(query));
  });
}

interface BrowseRowParts {
  li: HTMLLIElement;
  labelEl: HTMLElement;
  metaEl: HTMLElement;
}

/** One clickable row: an optional leading identifier, a wrapping label, an optional badge, and a
 * trailing detail. */
function browseRow(id: string, label: string, meta: string, onClick: () => void, badge?: string): BrowseRowParts {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "browse-item";
  const labelEl = document.createElement("span");
  labelEl.className = "browse-label";
  labelEl.textContent = label;
  const metaEl = document.createElement("span");
  metaEl.className = "browse-meta";
  metaEl.textContent = meta;
  // A row with nothing to identify it beyond its label leads with the label itself, rather than
  // with a decorative stand-in for the identifier other rows carry.
  if (id || badge) {
    // The identifier and the badge share the row's leading column, stacked: a badge set between
    // the identifier and the title pushes every title across by a different amount, so a column of
    // them no longer lines up to be read down.
    const idCol = document.createElement("span");
    idCol.className = "browse-idcol";
    if (id) {
      const idEl = document.createElement("span");
      idEl.className = "browse-id";
      idEl.textContent = id;
      idCol.append(idEl);
    }
    if (badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "badge restricted";
      badgeEl.textContent = badge;
      idCol.append(badgeEl);
    }
    button.append(idCol);
  }
  button.append(labelEl, metaEl);
  button.addEventListener("click", onClick);
  li.append(button);
  return { li, labelEl, metaEl };
}

/** Appends a line of explanatory text as the last row of a list. */
function browseNote(list: HTMLUListElement, message: string): void {
  const li = document.createElement("li");
  const p = document.createElement("p");
  p.className = "browse-empty";
  p.textContent = message;
  li.append(p);
  list.append(li);
}

function renderDandisetList(): void {
  const current = browse;
  browseRowLabels.clear();
  browseRowMeta.clear();
  if (!current) return;
  const matches = visibleDandisets(current);
  if (!matches.length) {
    browseEmpty(els.browseDandisets, current.datasets.length ? "No dataset matches that filter." : "No datasets found.");
    return;
  }
  const shown = matches.slice(0, BROWSE_ROW_LIMIT);
  els.browseDandisets.replaceChildren();
  for (const dandiset of shown) {
    const videos = current.videos.get(dandiset.id);
    const { li, labelEl, metaEl } = browseRow(
      dandiset.id,
      browseName(current, dandiset),
      videos ? videoCountLabel(videos.length) : dandiset.embargoed ? "" : bytes(dandiset.manifestBytes),
      () => void selectDandiset(dandiset),
      dandiset.embargoed ? "embargoed" : undefined,
    );
    if (dandiset.id === current.selected) li.firstElementChild?.setAttribute("aria-current", "true");
    browseRowLabels.set(dandiset.id, labelEl);
    browseRowMeta.set(dandiset.id, metaEl);
    els.browseDandisets.append(li);
  }
  if (matches.length > shown.length) {
    browseNote(els.browseDandisets, `Showing ${shown.length} of ${matches.length} matches — narrow the filter to see the rest.`);
  }
}

/** Opens one dataset, reading its file list first if the sweep has not already done so. */
async function selectDandiset(dandiset: ArchiveDandiset): Promise<void> {
  const current = browse;
  if (!current) return;
  const generation = browseGeneration;
  current.selected = dandiset.id;
  renderDandisetList();
  els.browseVideoHeading.textContent = `Videos in ${dandiset.id}`;
  els.browseDandisetLink.href = dandisetWebUrl(dandiset);
  els.browseDandisetLink.hidden = false;
  const known = current.videos.get(dandiset.id);
  if (known) {
    renderVideoList(known);
    return;
  }
  const cost = dandiset.embargoed ? "" : ` (${bytes(dandiset.manifestBytes)})`;
  browseVideosEmpty(`Reading the file list for ${dandiset.id}${cost}…`);
  try {
    const videos = await readDandisetVideos(dandiset, current.abort.signal);
    if (generation !== browseGeneration || browse?.selected !== dandiset.id) return;
    current.videos.set(dandiset.id, videos);
    const meta = browseRowMeta.get(dandiset.id);
    if (meta) meta.textContent = videoCountLabel(videos.length);
    renderVideoList(videos);
  } catch (e) {
    if (current.abort.signal.aborted || generation !== browseGeneration) return;
    log(`Could not read the file list for ${dandiset.id}: ${(e as Error).message}`, "err");
    browseVideosEmpty(`The file list for ${dandiset.id} could not be read: ${friendlyError(e)}`);
  }
}

/** Marks the row of the video the pane last picked, the same way the open dataset's row is marked.
 * Rows in another dataset's list never match, since the mark is held by asset URL: opening a second
 * dataset leaves nothing highlighted, which is the truth about that list. */
function markSelectedVideo(): void {
  for (const [assetUrl, button] of browseVideoRows) {
    if (assetUrl === browse?.selectedVideo) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function renderVideoList(videos: readonly ArchiveVideo[]): void {
  if (!videos.length) {
    browseVideosEmpty("This dataset holds no video files.");
    return;
  }
  browseVideoRows.clear();
  els.browseVideos.replaceChildren();
  for (const video of videos) {
    // The manifest reports every asset's size, so a file the player would refuse is marked as one
    // in the listing rather than only when it is picked. The mark rides in the trailing detail
    // beside the size that decided it, so a row carrying it still lines its path up with the rest.
    const refusal = unstreamableRefusal(video.path, video.size);
    const meta = refusal ? `${bytes(video.size)} · no streaming` : bytes(video.size);
    const { li } = browseRow("", video.path, meta, () => void streamArchiveVideo(video));
    const button = li.firstElementChild as HTMLElement | null;
    if (refusal) {
      button?.classList.add("blocked");
      button?.setAttribute("title", refusal);
    }
    if (button) browseVideoRows.set(video.assetUrl, button);
    els.browseVideos.append(li);
  }
  markSelectedVideo();
}

async function streamArchiveVideo(video: ArchiveVideo): Promise<void> {
  const name = video.path.split("/").pop() || video.path;
  // Marked before anything is attempted, a refusal included: the highlight says which row was
  // picked, the way the dataset list's does, and a file that will not open is one whose row most
  // needs pairing with the reason written out below it.
  if (browse) browse.selectedVideo = video.assetUrl;
  markSelectedVideo();
  // Settled against the size the archive reports, so an embargoed file is refused without a signed
  // link being asked for on its behalf.
  const refusal = unstreamableRefusal(video.path, video.size);
  // Refused or not, this is an attempt: whatever the last one left on the stage comes down first.
  clearLoadMessages();
  if (refusal) {
    log(`${name} will not be opened: ${refusal}`, "err");
    browseFailure(name, refusal);
    return;
  }
  let streamUrl = video.streamUrl;
  if (!streamUrl) {
    // Embargoed: the bytes sit behind a signature the archive has to issue, and it is only good for
    // a while, so it is asked for at the moment the video is opened rather than when it was listed.
    browseSay(`Asking EMBER for a link to ${name}…`);
    try {
      await ensureFreshOAuth();
      streamUrl = await resolveEmbargoedStreamUrl(browseConfig(), video.assetUrl);
    } catch (e) {
      log(`Could not open the embargoed file ${video.path}: ${(e as Error).message}`, "err");
      browseFailure(name, friendlyError(e));
      return;
    }
    browseSay("");
  }
  // Streamed from the bucket, which answers range requests cross-origin without a redirect, but
  // recorded against the archive's own asset URL: that is the one naming the file rather than its
  // content hash — and for an embargoed file, the only one that will still resolve tomorrow.
  // Reported in the pane, like the refusals above it: a video picked out of a list is answered for
  // where the list is, whether or not another one is already playing on the stage.
  void loadVideo(streamUrl, name, video.assetUrl, browseFailure, archiveSourceOf(video));
}

/**
 * Re-reads the archive when signing in or out has changed what the pane can see. Only then: the
 * auth path this hangs off runs on every load and on every change of upload destination, and
 * rebuilding the list underneath somebody who is reading it is not a free thing to do.
 */
function syncBrowseToAuth(): void {
  if (browse && browseSignedIn !== isSignedIn()) void refreshBrowse();
}

els.browseFilter.addEventListener("input", () => {
  clearTimeout(browseFilterTimer);
  browseFilterTimer = setTimeout(renderDandisetList, 150);
});

// SLEAP annotations step: hidden until the toggle above the player is switched on. The overlay
// switch on the player card follows it, since with the step off there is no overlay to show.
function syncSlpStep(): void {
  els.slpCard.hidden = !els.slpToggle.checked;
  els.showPoseRow.hidden = !els.slpToggle.checked;
}
function enableSlpStep(): void {
  els.slpToggle.checked = true;
  syncSlpStep();
}
els.slpToggle.addEventListener("change", () => {
  syncSlpStep();
  // The overlay is only drawn while the step is enabled, so re-render on either flip.
  renderFrame();
});

// Transport buttons
els.btnPlay.addEventListener("click", togglePlay);
els.btnPrev.addEventListener("click", () => {
  stopPlay();
  void seek(state.cur - 1);
});
els.btnNext.addEventListener("click", () => {
  stopPlay();
  void seek(state.cur + 1);
});
wireSeg(els.speedSeg, (v) => {
  state.speed = parseFloat(v);
});
els.btnClearSel.addEventListener("click", () => {
  resetSelection();
  selectionChanged();
  // The marks moved and the playhead moved with them, so the frame on the stage is decoded to match
  // rather than left showing wherever the playhead used to be. Forced, since resetSelection has
  // already written state.cur and an unforced seek onto it would read as a seek to nowhere; and
  // never as a shift-extend, since this is a reset of the marks rather than a scrub across them.
  void seek(state.cur, true, false);
});
els.showPose.addEventListener("change", () => {
  renderFrame();
  // Carried in the address like the rest of the session, so a link opens on the picture that was
  // being talked about rather than on the overlay whoever follows it happens to default to.
  syncUrl();
});

// Track Shift globally (regardless of focus) so shift-seeking extends the range. Anchor at the
// current frame when Shift is first pressed.
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift" && !shiftHeld) {
    shiftHeld = true;
    shiftAnchor = state.cur;
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") {
    shiftHeld = false;
    shiftAnchor = null;
  }
});
window.addEventListener("blur", () => {
  shiftHeld = false;
  shiftAnchor = null;
});

// Keyboard shortcuts. Form fields suppress them, so typing a frame index or a description is never
// also a transport command. The markers on the track handle their own arrow keys and stop those
// events before they reach here.
window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || tag === "INPUT") return;
  if (!state.backend) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    stopPlay();
    void seek(state.cur + (e.code === "ArrowRight" ? 1 : -1));
  }
});

// ============================================================
// File loading (dropzone mirrors bbqs-uploader's picker)
// ============================================================
function loadDroppedFile(f: File): void {
  if (/\.(slp|nwb|h5|hdf5)$/i.test(f.name)) void loadPoseFile(f, f.name);
  else void loadVideo(f, f.name);
}

function wireDropzone(dz: HTMLElement): void {
  ["dragenter", "dragover"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
    }),
  );
  dz.addEventListener("drop", (e) => {
    for (const f of e.dataTransfer?.files ?? []) loadDroppedFile(f);
  });
}
wireDropzone(els.dropzone);
wireDropzone(els.slpDropzone);

/** Whether a picker opened by {@link pickVideoFile} has yet to answer, either way. Nothing below
 * takes the line down unless this is still true: the same events fire around a load already in
 * progress, and that one is not theirs to end. */
let awaitingPick = false;

/**
 * Opens the file picker, with the dropzone already saying a video is on its way.
 *
 * The load itself is announced the moment the browser hands the file over, which is as early as any
 * page can manage — but that is not as early as the file was *chosen*. Between dismissing the
 * picker and the `change` event there is a stretch, longer for a large file or one on a network or
 * cloud-synced drive, that belongs to the browser: the page has not been told anything yet and can
 * only sit there looking like it missed the click. Saying so before the picker even opens puts
 * something in that gap that costs nothing to draw when the dialog comes down.
 */
function pickVideoFile(): void {
  awaitingPick = true;
  dropzoneStatus.show(LOADING_VIDEO);
  els.videoFile.click();
}

/** Ends the wait for a file that is not coming. */
function pickCancelled(): void {
  if (!awaitingPick) return;
  awaitingPick = false;
  dropzoneStatus.hide();
}

// How long after the window comes back a `change` may still arrive. Only a backstop for a browser
// without `cancel` below: long enough that a file on its way cannot lose the race, short enough
// that a dismissed picker does not leave the line sitting there.
const PICKER_CANCEL_GRACE_MS = 1500;
// Fired outright by browsers that have it when a picker is dismissed with nothing chosen.
els.videoFile.addEventListener("cancel", pickCancelled);
// The window coming back is the picker closing, one way or the other; which way is settled by
// whether a `change` follows.
window.addEventListener("focus", () => {
  if (!awaitingPick) return;
  setTimeout(pickCancelled, PICKER_CANCEL_GRACE_MS);
});

els.dropzone.addEventListener("click", () => pickVideoFile());
els.slpDropzone.addEventListener("click", () => els.slpFile.click());
// stopPropagation keeps a dropzone's own click handler from also firing on the inner buttons.
els.browseVideoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  pickVideoFile();
});
els.browseSlpBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.slpFile.click();
});
els.sampleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  void loadSample();
});
els.videoFile.addEventListener("change", () => {
  // Whatever happens next, the picker has answered: the line it left up is the load's now, or
  // nobody's.
  awaitingPick = false;
  const f = els.videoFile.files?.[0];
  if (f) void loadVideo(f, f.name);
  else dropzoneStatus.hide();
  els.videoFile.value = "";
});
els.slpFile.addEventListener("change", () => {
  const f = els.slpFile.files?.[0];
  if (f) void loadPoseFile(f, f.name);
  els.slpFile.value = "";
});
// Prevent the browser from navigating away when a file misses the dropzone.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// Sample
async function loadSample(): Promise<void> {
  const base = new URL("..", location.href).href; // repo root
  log("Loading sample from slp-viewer/…");
  await loadVideo(`${base}slp-viewer/mice.mp4`, "mice.mp4", `${base}slp-viewer/mice.mp4`);
  await loadPoseFile(`${base}slp-viewer/mice.tracked.slp`, "mice.tracked.slp");
}

// ============================================================
// EMBER sign-in + upload destination (mirrors bbqs-uploader)
// ============================================================
// Authorization Code + PKCE against the EMBER archive, then the same "Incoming: " dataset
// discovery the uploader uses: datasets the signed-in user owns whose title carries the BBQS
// staging-dataset prefix and that a BBQS/EMBER admin co-owns (see lib/dandisets.ts).
let oauthTokens: OAuthTokenSet | null = null;
// The dandiset id restored from a previous session, applied once the dropdown holds the signed-in
// user's incoming datasets (a <select> can't carry a value before its options exist).
let storedDandisetId = "";
// The picker's current option list, kept around so currentConfig() can read the selected
// dataset's embargo status without a second API round-trip.
let currentDatasets: IncomingDandiset[] = [];
// The signed-in account, resolved once for the header avatar and reused to name the uploader in
// each upload's provenance record.
let currentUser: ArchiveUser | null = null;
// The Download/Upload side the visitor picked themselves, in this session or a previous one. Null
// means they have never chosen, and the sign-in state decides (see applyDeliveryMode).
let storedDeliveryMode: DeliveryMode | null = null;

function loadSettings(): void {
  const s = loadStoredSettings();
  // Held to one of the offered widths whatever storage held, and reflected in the control either
  // way: it carries no active button of its own, so the default has to be painted onto it here.
  state.windowHalf = windowHalfSeconds(s?.windowHalfSeconds);
  selectSeg(els.windowSeg, String(state.windowHalf));
  if (!s) return;
  if (s.dandisetId) storedDandisetId = s.dandisetId;
  if (s.oauth) oauthTokens = s.oauth;
  if (s.deliveryMode) storedDeliveryMode = s.deliveryMode;
}

function saveSettings(): void {
  // The picker is empty whenever it has no options yet (signed out, or still loading), which is not
  // the same as "no dataset chosen" — keep the last known id instead of blanking it.
  const selected = els.dandisetId.value.trim();
  if (selected) storedDandisetId = selected;
  saveStoredSettings({
    dandisetId: storedDandisetId,
    oauth: oauthTokens ?? undefined,
    deliveryMode: storedDeliveryMode ?? undefined,
    windowHalfSeconds: state.windowHalf,
  });
}

function currentConfig(): ArchiveConfig {
  const selected = currentDatasets.find((d) => d.identifier === els.dandisetId.value);
  return resolveConfig({
    dandisetId: els.dandisetId.value,
    oauthAccessToken: oauthTokens?.accessToken,
    embargoed: selected?.embargoed,
  });
}

/**
 * Whether every auth-dependent render should read as signed in — real tokens, or a live-smoketest
 * stand-in. `?test&signed_out` forces this false regardless of a real stored token, without touching
 * that token: it is a render-time override, not a sign-out. `?test&num_datasets=` forces it true so
 * the destination picker, the delivery toggle and the human-subjects gate can be previewed without a
 * real sign-in; `signed_out` wins if both are somehow given, since a request to look signed out is
 * the more conservative one to honor.
 */
function isSignedIn(): boolean {
  if (testInjection?.signedOut) return false;
  if (testInjection?.numDatasets !== null && testInjection?.numDatasets !== undefined) return true;
  return oauthTokens !== null;
}

function renderAuthUI(): void {
  const signedIn = isSignedIn();
  els.oauthSigninBtn.hidden = signedIn;
  els.oauthSignedIn.hidden = !signedIn;
  // Upload is the only thing the delivery toggle leads to, and there is nowhere to upload to while
  // signed out — so the choice is not offered at all rather than offered and then refused.
  els.deliverToggleRow.hidden = !signedIn;
  // Once the real auth state is known, this element-level hidden state is authoritative; the
  // pre-paint script's stand-in attribute (see index.html) is no longer needed.
  delete document.documentElement.dataset.signedIn;
}

// Refreshes the access token first if it's near expiry, so the config used for the request that
// follows always carries a live token instead of one that's about to be rejected.
async function ensureFreshOAuth(): Promise<void> {
  if (!oauthTokens) return;
  const current = oauthTokens;
  const fresh = await ensureFreshToken(current).catch(() => current);
  if (fresh !== current) {
    oauthTokens = fresh;
    saveSettings();
  }
}

// The destination picker has three mutually exclusive views: a plain-text status message (signed
// out, loading, no datasets, error), plain text naming the one dataset there's nothing to choose
// between, or a dropdown when there's an actual choice to make.
function showDandisetView(view: "message" | "single" | "dropdown"): void {
  els.dandisetMessage.hidden = view !== "message";
  els.dandisetSingle.hidden = view !== "single";
  els.dandisetId.hidden = view !== "dropdown";
  updateDeliveryGate();
}

function setDandisetPlaceholder(text: string): void {
  els.dandisetMessage.textContent = text;
  showDandisetView("message");
}

function showDandisetSingle(dataset: IncomingDandiset): void {
  showDandisetView("single");
  const idCode = document.createElement("code");
  idCode.textContent = dataset.identifier;
  els.dandisetSingleText.replaceChildren("Uploading directly to EMBER Dandiset ", idCode, `, "${dataset.title}"`);
}

function applyDatasetList(datasets: IncomingDandiset[], unverified = 0): void {
  currentDatasets = datasets;
  if (!datasets.length) {
    // "Nothing to offer" has two very different causes: the admin check answered no (or the user
    // genuinely owns no incoming datasets), or it never answered at all. Telling someone to ask
    // an admin for access when the service is simply unreachable sends them after the wrong bug.
    setDandisetPlaceholder(
      unverified > 0
        ? "Could not verify your incoming datasets with the BBQS/EMBER admin service; datasets that cannot be verified are never offered. See the browser console for details."
        : "You have not been added to any direct-upload datasets; please reach out to EMBER/BBQS admins to request this.",
    );
    return;
  }
  // Dropdown mode always ranks options by ascending integer id, oldest dandiset first, regardless
  // of the order the archive returned them in.
  const ordered = datasets.length > 1 ? [...datasets].sort((a, b) => Number(a.identifier) - Number(b.identifier)) : datasets;
  els.dandisetId.replaceChildren(
    ...ordered.map((d) => {
      const opt = document.createElement("option");
      opt.value = d.identifier;
      opt.textContent = `(${d.identifier}) ${d.title}`;
      return opt;
    }),
  );
  const match = ordered.find((d) => d.identifier === storedDandisetId);
  const selected = match ?? ordered[0];
  // The select stays populated even while hidden (single-dataset view) so currentConfig() keeps
  // reading a real dandiset id from it.
  els.dandisetId.value = selected.identifier;
  if (datasets.length === 1) showDandisetSingle(selected);
  else showDandisetView("dropdown");
}

function updateViewDatasetLink(): void {
  const cfg = currentConfig();
  els.viewDatasetLink.hidden = !cfg.dandisetId;
  if (cfg.dandisetId) els.viewDatasetLink.href = `${cfg.web}/dandiset/${cfg.dandisetId}/draft`;
}

async function refreshDandisetOptions(): Promise<void> {
  if (!isSignedIn()) {
    currentDatasets = [];
    setDandisetPlaceholder("Please sign in to see your incoming datasets.");
    updateViewDatasetLink();
    applyDeliveryMode();
    syncBrowseToAuth();
    return;
  }
  // `?test&num_datasets=` fakes the destination list in place of the real listIncomingDandisets
  // call — the one EMBER API round trip a live smoketest must never make, since there is no real
  // sign-in behind it. Everything downstream of applyDatasetList (the embargo warning, the
  // human-subjects gate, the delivery toggle) is real code reading these fakes like any other list.
  if (testInjection?.numDatasets !== null && testInjection?.numDatasets !== undefined) {
    currentUser = { username: "test-user", name: "Live Smoketest" };
    els.oauthUsername.textContent = currentUser.name;
    applyDatasetList(fakeIncomingDatasets(testInjection.numDatasets, testInjection.embargoed, testInjection.humanSubjects));
    updateViewDatasetLink();
    applyDeliveryMode();
    void refreshHumanSubjectsGate();
    syncBrowseToAuth();
    return;
  }
  await ensureFreshOAuth();
  // Deliberately not awaited: the dataset listing below is the slow part visitors are waiting on,
  // and the header avatar can fill in whenever the identity call lands.
  void renderIdentity(els, currentConfig()).then((user) => {
    currentUser = user;
  });
  setDandisetPlaceholder("Loading your incoming datasets…");
  try {
    const { datasets, unverified } = await listIncomingDandisets(currentConfig());
    applyDatasetList(datasets, unverified);
  } catch (e) {
    log(`Could not load your datasets: ${(e as Error).message}`, "err");
    currentDatasets = [];
    setDandisetPlaceholder("Could not load your datasets");
  }
  saveSettings();
  updateViewDatasetLink();
  applyDeliveryMode();
  void refreshHumanSubjectsGate();
  syncBrowseToAuth();
}

/** Finishes a sign-in that is landing on this load: the redirect back from the archive's authorize
 * page arrives as an ordinary page load carrying a `code`. Kept apart from the dataset listing that
 * follows it, so that anything needing only a token can wait for only the token (see
 * streamUrlFor, which opens a link naming an embargoed asset). */
async function resumeSignIn(): Promise<void> {
  const callbackTokens = await handleRedirectCallback().catch((e) => {
    log(`OAuth sign-in callback failed: ${(e as Error).message}`, "err");
    return null;
  });
  if (callbackTokens) {
    oauthTokens = callbackTokens;
    saveSettings();
    renderAuthUI();
  }
}

async function initEmberAuth(): Promise<void> {
  await signInReady;
  await refreshDandisetOptions();
}

els.oauthSigninBtn.addEventListener("click", () => {
  // The archive can only return to the bare page address (see lib/oauth.ts), so the session in the
  // bar is held here for the load that comes back — signing in to upload a clip is no way to lose
  // the clip. Written out first, since a keystroke or a nudge of a handle may still be coalesced.
  writeUrl();
  stashUrlState(location.search);
  void startLogin();
});
els.oauthSignoutBtn.addEventListener("click", () => {
  const tokens = oauthTokens;
  oauthTokens = null;
  currentUser = null;
  saveSettings();
  renderAuthUI();
  if (tokens) void revokeToken(tokens);
  void refreshDandisetOptions();
});
els.dandisetId.addEventListener("change", () => {
  // The completion line names a dataset, so it does not survive a change of destination.
  clearDeliveryOutcomes();
  updateDeliveryGate();
  updateViewDatasetLink();
  saveSettings();
  // Whether the warning applies is a property of the dataset, so it is re-read for the new one.
  void refreshHumanSubjectsGate();
});

// ============================================================
// Delivery: save the extracted selection, or upload it to EMBER
// ============================================================
// Extraction runs on demand, when either button is pressed, so what leaves the page always matches
// the selection currently on screen — there is no stale "extracted" artifact to invalidate.
//
// Both routes assemble the same set of files (see assembleSelection): Upload registers each one as
// an asset in the destination dataset, Save packs the same tree into a single `.tar.gz`. So a saved
// bundle is not a lesser copy of an upload — unpacked, it is the upload.

// Guards both actions while an extraction or upload is in flight.
let deliveryBusy = false;
// Which side is on screen. Read by the human-subjects gate below, whose warning is about a
// destination and so has nothing to say while the selection is being saved to a computer instead.
let deliveryMode: DeliveryMode = "download";
// What the visitor last chose for "include the original content", so the blur tool can force it off
// — a blurred selection must not travel beside an unblurred original — and hand the choice back
// once the blur areas are gone.
let includeOriginal = els.uploadOriginal.checked;
// True from the press of Upload until that upload either fails or is retired by a change to what it
// sent. While it is set the button is gone rather than merely disabled: the upload is either still
// running or already done, and in neither case is pressing it again the thing to do.
let uploadSubmitted = false;

function setDeliveryMode(mode: DeliveryMode): void {
  deliveryMode = mode;
  els.downloadPane.hidden = mode !== "download";
  els.uploadPane.hidden = mode !== "upload";
  renderHumanSubjectsBanner();
  updateDeliveryGate();
}

/** Shows the side the visitor last picked — including across a refresh, which is why the choice is
 * persisted rather than kept in memory. With no choice on record, Upload leads whenever it is
 * actually usable (signed in, with at least one incoming dataset) and Download leads otherwise,
 * since there would be nowhere to upload to.
 *
 * Signing out forces Download without touching the stored choice: the toggle is off screen then
 * (see renderAuthUI), so Upload would otherwise be stuck on with no way back — and signing in again
 * still lands on the side that was picked. */
function applyDeliveryMode(): void {
  const mode = !isSignedIn() ? "download" : (storedDeliveryMode ?? defaultDeliveryMode(currentDatasets.length));
  selectSeg(els.deliverSeg, mode);
  setDeliveryMode(mode);
}

wireSeg(els.deliverSeg, (v) => {
  storedDeliveryMode = v as DeliveryMode;
  setDeliveryMode(storedDeliveryMode);
  saveSettings();
});

// Both buttons wait on a description, so the gate is re-read as it is typed rather than on blur.
els.selectionDescription.addEventListener("input", () => {
  updateDeliveryGate();
  syncUrl();
});
els.uploadOriginal.addEventListener("change", () => {
  // Only when the switch is the visitor's to set: the blur tool turns it off and disables it, and
  // that is not a preference to remember.
  if (!els.uploadOriginal.disabled) includeOriginal = els.uploadOriginal.checked;
});

// ============================================================
// Human-subjects gate (mirrors bbqs-uploader)
// ============================================================
// A dataset holding recordings of people is flagged by admins in its draft description (see
// lib/humanSubjects.ts). Picking one as the upload destination raises the same warning the uploader
// raises, holds the Upload button until it is confirmed, and brings out the blur tool above — which
// is what makes the "properly de-identified" the warning asks for something that can be done here.

// Whether the selected dataset's draft description carries the marker phrase, and the dandiset ids
// already confirmed this session, so flipping between datasets does not demand re-confirming one
// already confirmed. The counter guards the fetch, so a slow answer cannot apply to a newer
// selection.
let humanSubjectsRequired = false;
const confirmedHumanSubjects = new Set<string>();
let humanSubjectsRefreshSeq = 0;

/** True while a flagged dataset is actually in play: signed in, on the Upload side, with a dataset
 * picked. Saving a selection to a computer sends nothing anywhere, so the warning about what may be
 * uploaded to that dataset has nothing to say about it. */
function humanSubjectsFlagged(): boolean {
  return humanSubjectsRequired && isSignedIn() && deliveryMode === "upload" && els.dandisetId.value !== "";
}

/** True while that dataset's warning has not been confirmed for this session. */
function humanSubjectsUnconfirmed(): boolean {
  return humanSubjectsFlagged() && !confirmedHumanSubjects.has(els.dandisetId.value);
}

/** Hidden for an ordinary dataset, the full warning with its "I confirm" for an unconfirmed flagged
 * one, or a slimmed "confirmed" notice once confirmed. */
function renderHumanSubjectsBanner(): void {
  const flagged = humanSubjectsFlagged();
  const confirmed = confirmedHumanSubjects.has(els.dandisetId.value);
  els.humanSubjectsBanner.hidden = !flagged;
  els.humanSubjectsUnconfirmed.hidden = confirmed;
  els.humanSubjectsConfirmed.hidden = !confirmed;
  // The blur tool arrives with the warning, and leaves with it unless something has been blurred.
  renderBlurTools();
  updateDeliveryGate();
}

/**
 * Re-resolves whether the selected dataset needs the gate, by reading the marker phrase out of its
 * draft description. While the fetch is in flight the banner is hidden and the gate open; if the
 * fetch fails the gate deliberately stays open too — the marker is a best-effort convention, and
 * holding every upload on a transient metadata hiccup would be worse — with a warning left in the
 * console.
 */
async function refreshHumanSubjectsGate(): Promise<void> {
  const seq = ++humanSubjectsRefreshSeq;
  humanSubjectsRequired = false;
  renderHumanSubjectsBanner();
  // The fake datasets from `?test&num_datasets=&human_subjects` have no real draft description to
  // read the marker phrase out of, so the flag they were built with is applied directly instead of
  // asking fetchDraftMetadata about an id that does not exist.
  if (testInjection?.numDatasets !== null && testInjection?.numDatasets !== undefined) {
    humanSubjectsRequired = testInjection.humanSubjects;
    renderHumanSubjectsBanner();
    return;
  }
  const cfg = currentConfig();
  if (!cfg.dandisetId || !oauthTokens) return;
  try {
    const metadata = await fetchDraftMetadata(cfg);
    if (seq !== humanSubjectsRefreshSeq) return;
    humanSubjectsRequired = containsHumanSubjects(metadata);
  } catch (e) {
    if (seq !== humanSubjectsRefreshSeq) return;
    log(`Could not check the selected dataset for human-subjects data: ${(e as Error).message}`, "warn");
  }
  renderHumanSubjectsBanner();
}

els.humanSubjectsConfirmBtn.addEventListener("click", () => {
  if (els.dandisetId.value) confirmedHumanSubjects.add(els.dandisetId.value);
  renderHumanSubjectsBanner();
});

function setStatus(el: HTMLElement, message: string, cls: "" | "ok" | "err" = ""): void {
  el.textContent = message;
  el.className = cls ? `hint ${cls}` : "hint";
}

/** Same, followed by a link — so an outcome can hand over somewhere to go next. */
function setStatusLink(el: HTMLElement, message: string, href: string, linkText: string, cls: "" | "ok" | "err" = ""): void {
  const link = document.createElement("a");
  try {
    const url = new URL(href, window.location.origin);
    link.href = url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "about:blank";
  } catch {
    link.href = "about:blank";
  }
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = linkText;
  el.replaceChildren(message, link);
  el.className = cls ? `hint ${cls}` : "hint";
}

/** True while a status line is showing a finished delivery's outcome — where the bundle was saved,
 * where the upload landed, or why one failed — rather than a caption about what to do next. Those
 * are the only lines worth keeping: everything else is recomputed on any UI change. */
function showsOutcome(el: HTMLElement): boolean {
  return el.classList.contains("ok") || el.classList.contains("err");
}

/** Retires both routes' outcome lines, once what they described has stopped being true: a different
 * selection, a different source, a different destination, or another delivery starting. Merely
 * looking at the other pane is not one of those, which is why the panes do not clear them. */
function clearDeliveryOutcomes(): void {
  // Nothing to retire is the common case — this runs on every seek in frame mode — so it costs a
  // couple of reads rather than a whole re-derivation of the card.
  if (!uploadSubmitted && !showsOutcome(els.downloadStatus) && !showsOutcome(els.uploadStatus)) return;
  for (const el of [els.downloadStatus, els.uploadStatus]) if (showsOutcome(el)) setStatus(el, "");
  setUploadProgress(null);
  // Whatever went up no longer describes what is on screen, so offering to send it again does.
  uploadSubmitted = false;
  updateDeliveryGate();
}

/** Same, with a file name set in the monospace `code` style so it stands out from the prose. */
function setStatusNaming(el: HTMLElement, before: string, filename: string, after: string, cls: "" | "ok" | "err" = ""): void {
  const code = document.createElement("code");
  code.textContent = filename;
  el.replaceChildren(before, code, after);
  el.className = cls ? `hint ${cls}` : "hint";
}

/** Drives the single progress bar in the upload pane; null hides it. */
function setUploadProgress(fraction: number | null, done = false): void {
  els.uploadProgress.hidden = fraction === null;
  els.uploadProgressFill.style.width = `${Math.min(100, Math.max(0, (fraction ?? 0) * 100)).toFixed(1)}%`;
  els.uploadProgressFill.className = done ? "progress-fill ok" : "progress-fill";
}

/** In frame mode the current frame is always a valid selection; a snippet needs at least one of the
 * in/out points marked, since with neither the range silently means "the entire video" — which is
 * not something to hand off under the name of a clip. A load marks both (see resetSelection), so
 * this now only refuses a recording too short to bound a snippet in at all. */
function hasSelection(): boolean {
  return state.mode === "frame" || state.inF !== null || state.outF !== null;
}

/** The copy in the delivery card that names whichever kind of selection the selector is on. */
function updateDeliveryCopy(kind: SelectionKind): void {
  els.downloadHint.textContent = `Saves the selected ${kind} to your computer, packed with everything an upload would have carried.`;
  // A textarea honours line breaks in its placeholder, so the two sentences get a line each, with a
  // blank one between them.
  els.selectionDescription.placeholder = `What event does this ${kind} showcase?\n\nNote anything that went wrong in it, or any other details you want to share along with the clip.`;
}

/** The "include the original content" switch, and the note explaining the case where it is on offer
 * but withheld: a blurred selection must not travel beside an original that still holds the pixels
 * the blur was placed over. The switch is held off and disabled rather than hidden there, so it is
 * clear the original is being withheld and why. A source with no local bytes to send simply does
 * not raise the row at all. */
function updateOriginalContentRow(): void {
  // Original content can only ride along when its bytes are already in the browser; a range-streamed
  // URL is remote-hosted already, and re-fetching a whole video to push it back is not worth it.
  const canSendOriginal = state.sourceFile !== null || state.slpFile !== null;
  const blurred = state.blurRegions.length > 0;
  els.uploadOriginalRow.hidden = !canSendOriginal;
  els.uploadOriginal.disabled = blurred;
  els.uploadOriginal.checked = !blurred && includeOriginal;
  els.blurOriginalNote.hidden = !blurred || !canSendOriginal;
}

// Enablement, the embargo warning, and both panes' copy, all derived from the current video,
// selection, selector mode, and destination.
function updateDeliveryGate(): void {
  const cfg = currentConfig();
  const hasVideo = state.backend !== null;
  const notEmbargoed = cfg.embargoed === false;
  const kind: SelectionKind = state.mode === "frame" ? "frame" : "snippet";
  const selected = hasSelection();
  // Required on both routes: a clip nobody described is one nobody can act on once it is in the
  // archive, and the description is the one thing only the person making it can supply.
  const described = els.selectionDescription.value.trim() !== "";
  const unconfirmed = humanSubjectsUnconfirmed();
  els.dandisetEmbargoError.hidden = !notEmbargoed;
  els.btnDownload.disabled = deliveryBusy || !hasVideo || !selected || !described;
  els.btnUpload.disabled = deliveryBusy || !hasVideo || !selected || !described || !cfg.dandisetId || notEmbargoed || unconfirmed;
  els.btnUpload.hidden = uploadSubmitted;
  updateDeliveryCopy(kind);
  updateOriginalContentRow();
  if (deliveryBusy) return;
  updateDeliveryPreview();
  // Only ever says why the button is unavailable; a ready button needs no caption.
  const blocked = !hasVideo
    ? "Load a video to extract a selection."
    : !selected
      ? "Drag the In and Out handles under the player to select a snippet."
      : !described
        ? `Describe the ${kind} above before sending it on.`
        : "";
  // A finished delivery's own line outranks these captions until it is retired.
  if (!showsOutcome(els.downloadStatus)) setStatus(els.downloadStatus, blocked);
  if (!showsOutcome(els.uploadStatus)) {
    const destination = !cfg.dandisetId
      ? "Pick an upload destination above."
      : unconfirmed
        ? "Confirm the human-subjects notice above."
        : "";
    setStatus(els.uploadStatus, blocked || destination);
  }
}

/** The entities identifying whatever the selector currently points at, shared by every file the next
 * delivery writes (and by the bundle that holds them) — `beh` (subject, session, and this delivery's
 * own `recording-<label>` stamp, see lib/bidsPath.ts) is stamped fresh from `now`, since only the
 * actual moment of delivery should end up in a file name, not whenever a preview happened to redraw. */
function currentEntities(now: Date): AssetEntities {
  const [lo, hi] = state.mode === "frame" ? [state.cur, state.cur] : selRange();
  const mode: SelectionKind = state.mode === "frame" ? "frame" : "snippet";
  return { sourceName: state.sourceName, mode, inFrame: lo, outFrame: hi, beh: behEntities(now, state.sourceArchive?.path ?? null) };
}

/** Names the file the Save button is about to produce — the name alone, since it already spells out
 * the frame or the frame range. Refreshed on every seek too, frame mode's output following the
 * current frame, hence the long-lived child element rather than rebuilt markup. A preview only, so
 * its own `recording-<label>` stamp is whatever moment it happened to redraw at — the actual
 * delivery restamps it at the instant Save or Upload is pressed. */
function updateDeliveryPreview(): void {
  const show = state.backend !== null && hasSelection();
  els.downloadPreview.hidden = !show;
  if (!show) return;
  els.downloadPreviewName.textContent = bundleFileName(state.sourceArchive?.dandisetId ?? null);
}

function setDeliveryBusy(busy: boolean): void {
  deliveryBusy = busy;
  // Starting a delivery retires the last one's line, so the two are never on screen together.
  if (busy) clearDeliveryOutcomes();
  updateDeliveryGate();
  // An extraction reads the blur areas as it runs, so the tool is held still until it is finished.
  renderBlurTools();
}

/** Extracts the selection `entities` names: an MP4 snippet, or a single PNG frame. Driven by the
 * entities rather than by live state, so scrubbing on while an extraction runs cannot move what is
 * being extracted out from under the name it is being written as. */
async function extractSelection(
  backend: SleapVideoBackend,
  entities: AssetEntities,
  blur: BlurRegion[],
  onProgress: ExtractProgress,
): Promise<ExtractedMedia> {
  if (entities.mode === "frame") {
    onProgress(`Encoding frame ${entities.inFrame}…`);
    return extractFrame({
      backend,
      frameOrder: state.frameOrder,
      frame: entities.inFrame,
      width: state.width,
      height: state.height,
      sourceName: entities.sourceName,
      beh: entities.beh,
      blur,
    });
  }
  return extractClip({
    sourceFile: state.sourceFile,
    sourceUrl: state.sourceUrl,
    // What the open source can say for itself: its own bitstream either way, and — for a streamed
    // one — the trim that reads only the bytes the selection needs. The sleap-io.js fallbacks answer
    // for neither and fall through to ffmpeg as before.
    backend: describedSource(backend),
    sourceName: entities.sourceName,
    beh: entities.beh,
    lo: entities.inFrame,
    hi: entities.outFrame,
    fps: state.fps,
    blur,
    onProgress,
  });
}

/** One file of an assembled selection, ready for either route. */
interface DeliverableFile {
  blob: Blob;
  /** Where it lands: its asset path in the destination dataset, and the very same path inside a
   * saved bundle. */
  path: string;
  contentType: string;
  /** How the progress line names it. */
  label: string;
  /** The dandi-etag it is stored under, hashed once by the assembly step so that both the upload
   * and the provenance record quote the same value without hashing it twice. */
  digest: BlobDigest;
}

/** Hands one assembled file to whichever route asked for it. */
type DeliverFile = (file: DeliverableFile) => Promise<void>;

/** An extracted file together with the digest it will be stored under — cached as a pair, since
 * whatever is worth not encoding twice is worth not hashing twice either. */
interface ChecksummedMedia {
  media: ExtractedMedia;
  digest: BlobDigest;
}

// What makes a second delivery of a selection cheap: saving a bundle and then uploading it re-uses
// the files the save produced rather than re-encoding an overlay frame by frame and re-hashing a
// multi-gigabyte source. Each slot is keyed by everything its value was derived from, so a new
// selection, video or `.slp` simply fails to match and the work is done again.
const extractOnce = memoOne<ChecksummedMedia>();
const overlayOnce = memoOne<ChecksummedMedia>();
const sourceDigestOnce = memoOne<BlobDigest>();
const annotationDigestOnce = memoOne<BlobDigest>();

/** What an extraction was made from: which load of which video, which frames of it, and what was
 * blurred out of them. */
function selectionKey(entities: AssetEntities): string {
  return `source-${sourceGeneration}|${entities.mode}|${entities.inFrame}|${entities.outFrame}|blur-${blurGeneration}`;
}

const PHASE_LABEL: Record<UploadPhase, string> = { checksum: "Checksumming", upload: "Uploading", register: "Registering" };

function reportUploadStep(label: string, step: string, fraction: number): void {
  setStatus(els.uploadStatus, `${step} ${label}… ${(fraction * 100).toFixed(0)}%`);
  setUploadProgress(fraction);
}

/** Uploads one assembled file, under the digest it was already hashed to. */
async function uploadOne(cfg: ArchiveConfig, file: DeliverableFile): Promise<void> {
  log(`Uploading ${file.label} to ${file.path} (${bytes(file.blob.size)})…`);
  await uploadAsset(cfg, {
    blob: file.blob,
    path: file.path,
    contentType: file.contentType,
    digest: file.digest,
    onPhase: (phase, fraction) => reportUploadStep(file.label, PHASE_LABEL[phase], fraction),
  });
  log(`Uploaded ${file.path}`, "ok");
}

/** A loaded `.slp` that was checksummed, and delivered too when `path` is set. */
interface DeliveredSlp {
  digest: BlobDigest;
  path: string | null;
}

/** The rendered pose-overlay companion to a selection, once delivered. */
interface DeliveredOverlay {
  media: ExtractedMedia;
  path: string;
  digest: BlobDigest;
}

/**
 * Renders the selection with the pose drawn into the pixels, so it can be looked at without a viewer
 * that understands `.slp`. Null when no annotations are loaded, since there would be nothing to draw.
 * Deliberately not tied to the "include the original content" toggle: this is a view of the
 * selection, not a copy of a source.
 */
async function deliverOverlay(
  deliver: DeliverFile,
  directory: string,
  mediaPath: string,
  entities: AssetEntities,
  backend: SleapVideoBackend,
  blur: BlurRegion[],
  onProgress: ExtractProgress,
): Promise<DeliveredOverlay | null> {
  const pose = els.slpToggle.checked ? state.pose : null;
  if (!pose) return null;
  const label = "the pose overlay";
  // Drawing an overlay is the slowest thing this app does — every frame decoded, drawn and encoded
  // — so a second delivery of the same selection and the same pose re-uses the one already drawn.
  const { media, digest } = await overlayOnce(`${selectionKey(entities)}|pose-${poseGeneration}`, async () => {
    const media = await extractOverlay({
      backend,
      frameOrder: state.frameOrder,
      pose,
      mode: entities.mode,
      inFrame: entities.inFrame,
      outFrame: entities.outFrame,
      fps: state.fps,
      width: state.width,
      height: state.height,
      sourceName: entities.sourceName,
      beh: entities.beh,
      blur,
      onProgress,
    });
    return { media, digest: await checksumFor(media.blob, label, onProgress) };
  });
  const path = uploadAssetPath(directory, media.filename);
  await deliver({ blob: media.blob, path, contentType: media.mime, label, digest });

  // Its own light BEP047 sidecar (see lib/provenance.ts's buildCompanionSidecar) rather than the
  // plain clip's full record: it is a rendering of that clip, not a second source of truth about it,
  // so `Sources` is enough to tie the two together.
  const technical =
    entities.mode === "frame"
      ? imageTechnicalFields(state.width, state.height, media.technical)
      : videoTechnicalFields(state.fps, state.width, state.height, entities.outFrame - entities.inFrame + 1, media.technical);
  const sidecar = buildCompanionSidecar({
    description: "The selection with the pose overlay drawn into the pixels.",
    technical,
    sources: [mediaPath],
    checksum: { md5: digest.md5, sha256: digest.sha256, dandiEtag: digest.etag },
  });
  const sidecarBlob = new Blob([JSON.stringify(sidecar, null, 2)], { type: "application/json" });
  const sidecarPath = uploadAssetPath(directory, sidecarFileName(entities.beh, entities.mode, "overlay"));
  const sidecarLabel = "the pose overlay's sidecar";
  await deliver({
    blob: sidecarBlob,
    path: sidecarPath,
    contentType: "application/json",
    label: sidecarLabel,
    digest: await checksumFor(sidecarBlob, sidecarLabel, onProgress),
  });
  return { media, path, digest };
}

/** Checksums the source video, and hands it over when the toggle asks for it. The checksum is taken
 * either way: recording which video a clip came from is only useful if that video can be identified
 * again later — and `sourceDigestOnce` holds it for whatever asks next, so nothing is handed back
 * from here. */
async function deliverOriginalVideo(deliver: DeliverFile, directory: string, beh: BehEntities, onProgress: ExtractProgress): Promise<void> {
  const original = state.sourceFile;
  if (!original) return;
  const label = "the original video";
  // Keyed to the load rather than the selection: the same bytes hash to the same digest however
  // many selections are cut out of them, and this is the hash that can take minutes.
  const originalDigest = await sourceDigestOnce(`source-${sourceGeneration}`, () => checksumFor(original, label, onProgress));
  if (!els.uploadOriginal.checked) return;
  // Whether the source carries sound decides both what this copy is called and what its sidecar can
  // say about it. BEP047 names an audio-bearing recording `_audiovideo` where a silent one is
  // `_video`, and this copy is the only file a delivery writes that can be either: everything
  // extracted from it drops audio on the way out (see lib/ffmpeg.ts), so the derivative stays
  // `_video` whatever the source held. Read off the file itself rather than assumed from its
  // container or its name (see lib/audioFormat.ts); one that cannot be opened at all reads as silent.
  const audio = await audioFormatInfo(original);
  // BEP047 entity-shaped, like everything else this app writes — not the name it arrived with — but
  // with no disambiguator at all (see lib/bidsPath.ts's own header comment and
  // `sourcedataOriginalFilename`): re-delivering the same source is expected to overwrite this copy,
  // not duplicate it.
  const originalName = sourcedataOriginalFilename(beh, original.name, audio !== null);
  const originalPath = uploadAssetPath(directory, originalName);
  await deliver({
    blob: original,
    path: originalPath,
    contentType: original.type || "video/mp4",
    label,
    digest: originalDigest,
  });

  // The technical properties of the source itself — already read off its own container when it was
  // loaded (see loadVideo), not re-derived here — so the raw file sitting in `sourcedata` carries the
  // same kind of sidecar a BEP047 media file does, without needing a probing library of its own.
  // Codec, its RFC 6381 string, pixel format and bit depth are only known when the streaming backend
  // itself named them; the sleap-io.js fallback backends never expose any of this to this app, so
  // nothing is claimed rather than guessed. A `?test&mock_video` preview is the one exception: its
  // synthesized clip is really VP8 (see lib/testInjection.ts's synthesizeVideoFile), an implementation
  // detail of the mock rather than anything worth previewing — the values below are h264's own typical
  // ones instead, which is what a real delivery's own source almost always reports, spelled the way
  // that source would be read back (mediabunny names H.264 `"avc"`).
  const isMockVideo = testInjection?.mockVideoFrames != null || testInjection?.mockVideoLongSeconds != null;
  const sourceDetail: TechnicalDetail = isMockVideo
    ? { codec: "avc", codecRFC6381: "avc1.42E01E", pixelFormat: "yuv420p", bitDepth: 8 }
    : (describedSource(state.backend)?.technical ?? {});
  await deliverSidecar(deliver, directory, originalName, onProgress, {
    description: "The source video this selection was clipped from.",
    technical: {
      ...videoTechnicalFields(state.fps, state.width, state.height, state.totalFrames, sourceDetail),
      ...audioTechnicalFields(audio),
    },
    sources: [],
    checksum: { md5: originalDigest.md5, sha256: originalDigest.sha256, dandiEtag: originalDigest.etag },
  });
}

/** Same for a loaded pose file (`.slp` or `.nwb`): it rides along on the same toggle and is
 * checksummed either way. Placed in `derivatives/` alongside the extract, not `sourcedata/`: it is
 * itself the output of a pose estimation pipeline run over the source video, not the raw recording.
 *
 * It travels without a sidecar of its own. Both formats are self-describing — a `.slp` and an `.nwb`
 * each carry their own skeleton, their own frame indices and their own provenance inside the file —
 * so a companion `.json` naming the format and pointing back at the video would only restate what
 * opening the file says better. The video and image assets this app produces still get theirs: those
 * are BEP047 media files, where the sidecar is where the technical keys are defined to live. */
async function deliverAnnotationFile(deliver: DeliverFile, directory: string, onProgress: ExtractProgress): Promise<DeliveredSlp | null> {
  const slpFile = state.slpFile;
  if (!slpFile) return null;
  const label = "the annotations";
  const digest = await annotationDigestOnce(`pose-${poseGeneration}`, () => checksumFor(slpFile, label, onProgress));
  if (!els.uploadOriginal.checked) return { digest, path: null };
  const path = uploadAssetPath(directory, verbatimFilename(slpFile.name));
  await deliver({ blob: slpFile, path, contentType: slpFile.type || "application/octet-stream", label, digest });
  return { digest, path };
}

/** Writes a companion sidecar beside an already-delivered file: same base name, `.json` in place of
 * its extension. Shared by the source video and the `.slp`, neither of which is itself a BEP047
 * media file this app produced — see lib/provenance.ts's buildCompanionSidecar. */
async function deliverSidecar(
  deliver: DeliverFile,
  directory: string,
  filename: string,
  onProgress: ExtractProgress,
  input: Parameters<typeof buildCompanionSidecar>[0],
): Promise<void> {
  const sidecar = buildCompanionSidecar(input);
  const sidecarBlob = new Blob([JSON.stringify(sidecar, null, 2)], { type: "application/json" });
  const sidecarName = `${verbatimFilename(filename).replace(/\.[^./]+$/, "")}.json`;
  const sidecarPath = uploadAssetPath(directory, sidecarName);
  const label = `${filename}'s sidecar`;
  await deliver({
    blob: sidecarBlob,
    path: sidecarPath,
    contentType: "application/json",
    label,
    digest: await checksumFor(sidecarBlob, label, onProgress),
  });
}

/** Hashes one file for delivery, reporting progress on whichever route's status line is listening. */
function checksumFor(blob: Blob, label: string, onProgress: ExtractProgress): Promise<BlobDigest> {
  return checksumBlob(blob, (fraction) => onProgress(`${PHASE_LABEL.checksum} ${label}… ${(fraction * 100).toFixed(0)}%`, fraction));
}

interface AssembleParams {
  /** Captured by the caller: `state.backend` is mutable, so a load mid-delivery must not swap what
   * these steps are reading frames from. */
  backend: SleapVideoBackend;
  /** Runs once after extraction, before the first file is handed over — where the upload route
   * refreshes its token, so a long encode cannot age it out mid-transfer. */
  onReady?: () => Promise<void>;
  /** Reads whichever of the two `dataset_description.json` files (see lib/datasetDescription.ts)
   * already exist at the destination, so this delivery's `GeneratedBy` entry folds into them rather
   * than replacing whatever another pipeline already recorded there. Omitted for a saved bundle,
   * which has no archive to read one from — its two files are always written fresh. */
  existingDescriptions?: () => Promise<ExistingDatasetDescriptions>;
  deliver: DeliverFile;
  onProgress: ExtractProgress;
}

interface AssembledSelection {
  entities: AssetEntities;
  directories: DeliveryDirectories;
  createdAt: Date;
}

/**
 * Extracts the current selection and hands every file it produces to `deliver`, in the order they
 * are meant to land: the selection itself, its pose overlay and their sidecars, the original
 * content, then both `dataset_description.json` files this delivery's `GeneratedBy` entry belongs
 * in. Both routes come through here, which is what makes a saved bundle hold exactly what an upload
 * would have written.
 */
async function assembleSelection(params: AssembleParams): Promise<AssembledSelection> {
  const { backend, deliver, onProgress } = params;
  // One instant for the whole delivery, so the `recording-<label>` entity every file shares and the
  // sidecar's own `created_at` name the same moment.
  const createdAt = new Date();
  const entities = currentEntities(createdAt);
  const { mode: kind, inFrame: lo, outFrame: hi, beh } = entities;
  // Copied, not referenced: every file this delivery writes has to be blurred the same way, and the
  // areas on screen are editable until the moment the controls are disabled.
  const blur = state.blurRegions.map((region) => ({ ...region }));
  // Re-used when this selection has already been extracted — saving a bundle and then uploading it
  // encodes nothing the second time round.
  const { media, digest: mediaDigest } = await extractOnce(selectionKey(entities), async () => {
    const media = await extractSelection(backend, entities, blur, onProgress);
    return { media, digest: await checksumFor(media.blob, `the ${kind}`, onProgress) };
  });
  await params.onReady?.();
  const directories = deliveryDirectories(beh);

  // The extracted selection goes first: it is the point of the delivery, and the original — which
  // can be orders of magnitude larger — is a recommended companion, not a prerequisite for it.
  const mediaPath = uploadAssetPath(directories.derivatives, media.filename);
  await deliver({ blob: media.blob, path: mediaPath, contentType: media.mime, label: `the ${kind}`, digest: mediaDigest });

  await deliverOverlay(deliver, directories.derivatives, mediaPath, entities, backend, blur, onProgress);
  await deliverOriginalVideo(deliver, directories.sourcedata, beh, onProgress);
  await deliverAnnotationFile(deliver, directories.derivatives, onProgress);

  const provenanceInput: ProvenanceInput = { description: els.selectionDescription.value };

  // The sidecar the extracted clip/frame itself carries: BEP047's own technical keys, a BEP028
  // `GeneratedBy` entry, and the description typed for this delivery — see lib/provenance.ts.
  const technical =
    kind === "frame"
      ? imageTechnicalFields(state.width, state.height, media.technical)
      : videoTechnicalFields(state.fps, state.width, state.height, hi - lo + 1, media.technical);
  const sidecar = buildBehSidecar(provenanceInput, technical, {
    md5: mediaDigest.md5,
    sha256: mediaDigest.sha256,
    dandiEtag: mediaDigest.etag,
  });
  const sidecarBlob = new Blob([JSON.stringify(sidecar, null, 2)], { type: "application/json" });
  const sidecarPath = uploadAssetPath(directories.derivatives, sidecarFileName(beh, kind));
  const sidecarLabel = "the sidecar record";
  // The one file that is never re-used: it names this delivery's own instant, so it differs even
  // when everything it describes was carried over from the last one.
  await deliver({
    blob: sidecarBlob,
    path: sidecarPath,
    contentType: "application/json",
    label: sidecarLabel,
    digest: await checksumFor(sidecarBlob, sidecarLabel, onProgress),
  });

  // Every `dataset_description.json` this delivery's tool identity belongs in — the dataset root's
  // own, the derivatives pipeline's, and sourcedata/rawbids's own (so that subtree validates as a
  // complete raw BIDS dataset by itself) — folded in rather than overwritten (see
  // lib/datasetDescription.ts). A bundle has no archive to read existing ones from, so it always
  // writes them fresh; unpacked into a dataset that already has its own, a person reconciles them by
  // hand, same as any other file a bundle might collide with.
  const existing = (await params.existingDescriptions?.()) ?? { root: null, derivatives: null, sourcedata: null };
  const generatedByEntry = buildGeneratedByEntry();
  const sourceDataset = buildSourceDatasetEntry(currentConfig().api, state.sourceArchive);
  // Read off the module-level identity rather than `provenanceInput.user` (which is only ever set on
  // the upload route, since that field also drives the sidecar's own `uploaded_by`): a visitor can be
  // signed in while using Save, and deserves the same credit there.
  const descriptions = mergedDatasetDescriptions(existing, generatedByEntry, sourceDataset, kind, currentUser?.username ?? null);
  for (const [path, doc] of [
    [DATASET_DESCRIPTION_PATH, descriptions.root],
    [DERIVATIVES_DESCRIPTION_PATH, descriptions.derivatives],
    [SOURCEDATA_DESCRIPTION_PATH, descriptions.sourcedata],
  ] as const) {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    await deliver({ blob, path, contentType: "application/json", label: path, digest: await checksumFor(blob, path, onProgress) });
  }

  return { entities, directories, createdAt };
}

/** Saves the selection as a `.tar.gz` holding the same files, at the same paths, an upload would
 * have written — so what is on disk can be unpacked, read, or handed to someone else without having
 * to reconstruct what the archive would have seen. */
async function runDownload(): Promise<void> {
  const backend = state.backend;
  if (!backend) return;
  setDeliveryBusy(true);
  try {
    const bundled: BundleEntry[] = [];
    const { createdAt } = await assembleSelection({
      backend,
      onProgress: (message) => setStatus(els.downloadStatus, message),
      // Every file is hashed on its way in even though nothing is being uploaded: the sidecar
      // inside the bundle quotes the same digests an upload would have registered, so a selection
      // saved now and uploaded later is identifiable as the same bytes.
      deliver: (file) => {
        bundled.push({ path: file.path, blob: file.blob });
        return Promise.resolve();
      },
    });
    setStatus(els.downloadStatus, "Packing the bundle…");
    const bundle = await tarGzip(bundled, createdAt);
    const filename = bundleFileName(state.sourceArchive?.dandisetId ?? null);
    saveBlob(bundle, filename);
    setDeliveryBusy(false);
    setStatusNaming(els.downloadStatus, "Saved ", filename, ` (${bundled.length} files, ${bytes(bundle.size)})`, "ok");
    log(`Saved ${filename} (${bundled.length} files, ${bytes(bundle.size)})`, "ok");
  } catch (e) {
    setDeliveryBusy(false);
    setStatus(els.downloadStatus, friendlyError(e), "err");
    log(`Save failed: ${friendlyError(e)}`, "err");
    console.error(e);
  }
}

async function runUpload(): Promise<void> {
  const backend = state.backend;
  if (!backend) return;
  // Set after setDeliveryBusy, which retires the previous delivery — and would otherwise retire this
  // one's flag with it.
  setDeliveryBusy(true);
  uploadSubmitted = true;
  updateDeliveryGate();
  setUploadProgress(0);
  try {
    const { directories } = await assembleSelection({
      backend,
      onReady: async () => {
        // Refresh the token before the first request rather than mid-transfer, where an expiry would
        // strand a half-finished multipart upload.
        await ensureFreshOAuth();
        const cfg = currentConfig();
        if (!cfg.dandisetId) throw new Error("Pick an upload destination first.");
        // The sidecar names the uploader, so resolve the account here if the header's own lookup has
        // not landed (or was never made) yet.
        currentUser ??= await fetchArchiveUser(cfg).catch(() => null);
      },
      existingDescriptions: () => readExistingDatasetDescriptions(currentConfig()),
      onProgress: (message, fraction) => {
        setStatus(els.uploadStatus, message);
        setUploadProgress(fraction ?? 0);
      },
      deliver: (file) => uploadOne(currentConfig(), file),
    });

    const cfg = currentConfig();
    setDeliveryBusy(false);
    setUploadProgress(1, true);
    // Deliberately terse: uploadOne() has already logged every asset path to the console, and the
    // link goes straight to this upload's own derivatives directory in the archive's file browser.
    setStatusLink(
      els.uploadStatus,
      "Upload complete - ",
      fileBrowserUrl(cfg.web, cfg.dandisetId, directories.derivatives),
      "click here to view and share",
      "ok",
    );
    log(`Upload complete: ${directories.derivatives}/`, "ok");
  } catch (e) {
    // Back on offer: a failed upload is one worth pressing again.
    uploadSubmitted = false;
    setDeliveryBusy(false);
    setUploadProgress(null);
    setStatus(els.uploadStatus, `Upload failed: ${friendlyError(e)}`, "err");
    log(`Upload failed: ${friendlyError(e)}`, "err");
    console.error(e);
  }
}

els.btnDownload.addEventListener("click", () => void runDownload());
els.btnUpload.addEventListener("click", () => void runUpload());

loadSettings();
renderAuthUI();
// Applied before the archive is consulted so a restored choice is the first thing painted, rather
// than the default briefly winning and being corrected once the dataset listing lands.
applyDeliveryMode();
// Started here and awaited in both directions: by the dataset listing, which needs whichever token
// this load ends up holding, and by a link being opened below against an archive asset.
const signInReady = resumeSignIn();
void initEmberAuth();

/**
 * The address a remote video's bytes are read from, which is not always the address a link names.
 *
 * The archive's own asset URL is what a link carries (see lib/embargoed.ts), but its bytes sit
 * behind a redirect — and for an embargoed file, behind a signature the archive only issues to a
 * signed-in token. So a signed-in visitor makes the same exchange the browse pane makes when a row
 * is picked, and streams from the bucket the archive points at. Anything else, and any exchange
 * that fails, is opened at the address given: that is what a URL param has always done, and a
 * failure then reports itself on the stage rather than here.
 */
async function streamUrlFor(url: string): Promise<string> {
  if (!isAssetDownloadUrl(currentConfig(), url)) return url;
  // Waited on rather than read straight off: this load may be the one a sign-in is landing on, and
  // a link shared out of the browse pane is very often one only a signed-in visitor can open.
  await signInReady;
  if (!oauthTokens) return url;
  try {
    await ensureFreshOAuth();
    return await resolveEmbargoedStreamUrl(currentConfig(), url);
  } catch (e) {
    // The address is logged as an argument rather than interpolated into the message: it comes off
    // the query string, and console.warn reads its first argument as a format string.
    console.warn("Could not ask EMBER where this asset is streamed from; opening the address as given:", url, e);
    return url;
  }
}

/** A file name for a URL: its last path segment, or `fallback` where that names nothing — the
 * archive's asset endpoints end in `/download/`, which is not a file name. */
function nameFromUrl(url: string, fallback: string): string {
  const last = url.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() ?? "";
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last : fallback;
}

/** Puts a link's marks back on the video it just opened. Held to the video's own bounds, like every
 * other way a frame is set here, so a link made against a longer recording lands at the end of this
 * one rather than off it. */
async function applyUrlMarks(link: UrlState): Promise<void> {
  if (!state.backend) return;
  const last = Math.max(0, state.totalFrames - 1);
  const held = (frame: number | null): number | null => (frame === null ? null : Math.max(0, Math.min(last, frame)));
  const lo = held(link.inF);
  const hi = held(link.outF);
  // A link naming no marks at all is a link to the video and nothing more — the older `?url=`
  // spelling is exactly that — so it keeps the range the load already marked out rather than
  // stripping it back off again.
  if (lo !== null || hi !== null) {
    // Ends the wrong way round are put back in order rather than refused: which is In and which is
    // Out is what the two numbers say, not which of them a hand-written link put first.
    state.inF = lo !== null && hi !== null ? Math.min(lo, hi) : lo;
    state.outF = lo !== null && hi !== null ? Math.max(lo, hi) : hi;
  }
  if (link.mode === "frame") {
    selectSeg(els.modeSeg, "frame");
    setMode("frame");
  }
  selectionChanged();
  // A hand-written link can name marks and no playhead. Landing on the start of the range it names
  // keeps it looking like a link the app wrote, rather than leaving the playhead a fifth into a
  // track whose band has just moved somewhere else (see resetSelection).
  const frame = held(link.frame) ?? (lo !== null || hi !== null ? selRange()[0] : null);
  // Forced, because the frame a link names can be the one the load already opened on, which would
  // otherwise be a seek to where the player already is.
  if (frame !== null) await seek(frame, true);
}

/**
 * Opens whatever the address describes: the streamed video and pose file, the marks made in them,
 * and the description typed for the delivery (see lib/urlState.ts).
 *
 * `?url=` and `?pose=` on their own are the older, hand-written spelling of the same thing (`?slp=`
 * older still) and still mean what they always did — a video and a pose file, with nothing marked.
 */
async function initFromUrl(): Promise<void> {
  // Read before anything below can rewrite it, and before the first coalesced write lands.
  const held = takeStashedUrlState();
  const inBar = readUrlState(location.search);
  // An address with no video in it and a session held from a sign-in means this is the load that
  // came back from the archive's authorize page, which can only return to the bare page address:
  // the session that was left behind is picked back up here.
  const link = inBar.url ? inBar : held ? readUrlState(held) : inBar;
  if (link.description) {
    els.selectionDescription.value = link.description;
    updateDeliveryGate();
  }
  // Set before the video, so the first frame is drawn the way the link asks for. On its own this
  // changes nothing on screen: with no pose loaded there is no overlay and no switch to see. It is
  // what the switch reads once one arrives — including a local pose file dropped in beside a link
  // to a streamed recording, which is the pairing a link cannot carry by itself.
  els.showPose.checked = link.overlay;
  if (link.url) {
    // A remote URL is the EMBER-stream path — reflect it in the source toggle.
    selectSeg(els.srcSeg, "ember");
    setSrcPane("ember");
    els.emberUrl.value = link.url;
    await loadVideo(await streamUrlFor(link.url), nameFromUrl(link.url, "video.mp4"), link.url);
    // Before the pose file, which is the slower half of a link and has nothing to do with where the
    // marks go.
    await applyUrlMarks(link);
  }
  if (link.pose) await loadPoseFile(link.pose, nameFromUrl(link.pose, "labels.slp"));
  // Whatever was restored is now the session, so the bar says so — it may have come out of the
  // sign-in stash rather than out of the bar itself. A video that did not open leaves the link
  // there all the same: a reload is then another go at it rather than the end of it.
  writeUrl(state.sourceUrl ? urlState() : link);
}

// ============================================================
// `?test&mock_video`/`&mock_slp` — see lib/testInjection.ts
// ============================================================
// The single highest-value injection: most of the others are only interesting once a video is on
// screen, and this is the only one that puts one there without a local file or a real stream.

/** `mock_ready`'s own step: marks a selection and types a description, the two things Save/Upload
 * gate on (see updateDeliveryGate), so the mock video lands directly on a saveable state — the whole
 * point of the injection being to preview real Save/Upload *output* without doing that by hand each
 * time. `&snippet` marks a real range instead of the default `&frame`'s still frame — frame mode
 * needs no ffmpeg.wasm (and so no CDN) to extract, which is why it is the default, but a snippet is
 * worth previewing live too (`extracted`'s own `VideoCodec`/etc, an overlay if `mock_slp` is given).
 *
 * Both land on real, deliberately mid-clip indices rather than the whole recording or the frame it
 * opened on (see lib/testInjection.ts's `MOCK_READY_FRAME`/`MOCK_READY_RANGE`, and `&frame=<n>` /
 * `&snippet=<lo>-<hi>` to name others). Held to this video's own bounds the same way `applyUrlMarks`
 * holds a hand-written link's, so a short `mock_video=<n>` still lands somewhere real rather than
 * past the end. The frame case has to move the playhead, not just the marks: frame mode extracts
 * whatever `state.cur` points at (see `currentEntities`). */
async function applyMockReady(injection: TestInjection): Promise<void> {
  const last = Math.max(0, state.totalFrames - 1);
  const held = (frame: number): number => Math.max(0, Math.min(last, frame));
  if (injection.mockReadyMode === "snippet") {
    state.inF = held(injection.mockReadyRange.lo);
    state.outF = held(injection.mockReadyRange.hi);
    selectionChanged();
    // Parked on the range's own start, the way a load parks it on the range it marks out, so the
    // picture on screen is inside what would be extracted. Never extending the marks that were just
    // set, whatever a key held during the load might otherwise have meant.
    await seek(state.inF, true, false);
  } else {
    selectSeg(els.modeSeg, "frame");
    setMode("frame");
    await seek(held(injection.mockReadyFrame), true, false);
  }
  els.selectionDescription.value = "Mock description, from a ?test&mock_ready live-test link.";
  updateDeliveryGate();
}

/** Loads a synthesized clip exactly as if it had been dropped onto the picker, so every real load
 * path (frame decode, timeline, delivery panes) runs against it unmodified. `mock_video_long` takes
 * the sparse, fast-to-build path instead (see `synthesizeLongVideoFile`) — the two are mutually
 * exclusive, since both stand in for the same drop. `&from_ember` gives the mock video a fixed,
 * BIDS-entity-shaped source path/URL instead (see lib/testInjection.ts's `fromEmberSourcePath`),
 * previewing the more advanced metadata an archive-sourced delivery carries — a real `URL` in
 * `SourceDatasets`, a known subject/session in the derivatives path — rather than the `sub-unknown`,
 * no-URL fallback `&from_local` (the default, and still the common "dropped locally" case) previews. */
async function applyMockVideo(): Promise<void> {
  if (testInjection?.mockVideoFrames != null) {
    const file = testInjection.mockAudio
      ? await synthesizeAudioVideoFile(testInjection.mockVideoFrames)
      : await synthesizeVideoFile(testInjection.mockVideoFrames);
    await loadVideo(
      file,
      file.name,
      fromEmberSourceUrl(testInjection, file.name),
      undefined,
      fromEmberArchiveSource(testInjection, file.name),
    );
    if (testInjection.mockSlp) applyMockSlp();
    if (testInjection.mockReady) await applyMockReady(testInjection);
    return;
  }
  if (testInjection?.mockVideoLongSeconds != null) {
    const file = await synthesizeLongVideoFile(testInjection.mockVideoLongSeconds);
    await loadVideo(
      file,
      file.name,
      fromEmberSourceUrl(testInjection, file.name),
      undefined,
      fromEmberArchiveSource(testInjection, file.name),
    );
    if (testInjection.mockReady) await applyMockReady(testInjection);
  }
}

/**
 * Synthesizes a pose model over the mock video and runs it through the real match-checking code
 * (`slpVideoMismatches`/`slpVideoWarnings`) rather than a fake DOM overlay, so the SLEAP card, the
 * pose overlay and — with `&mismatch` — the mismatch refusal all behave exactly as they would for a
 * real `.slp`. Building the HDF5 bytes of an actual `.slp` in-page is not worth doing for a preview:
 * this constructs the same in-memory `PoseModel`/`SlpSourceMeta` shapes `loadPoseFile` would have
 * derived from one, and hands them to the same downstream code.
 */
function applyMockSlp(): void {
  if (!state.backend) return;
  enableSlpStep();
  const nodes = ["nose", "left_ear", "right_ear", "tail_base"];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
  ];
  const byFrame = new Map<number, PoseInstance[]>();
  for (let f = 0; f < state.totalFrames; f++) {
    // A pose that visibly walks across the frame, so a screenshot at any point in the clip shows
    // something moving rather than four dots frozen in one spot.
    const t = state.totalFrames > 1 ? f / (state.totalFrames - 1) : 0;
    const cx = state.width * (0.15 + 0.7 * t);
    const cy = state.height * 0.5;
    byFrame.set(f, [
      {
        track: 0,
        kind: "predicted",
        score: 0.9,
        points: [
          { x: cx, y: cy - 10, score: 0.9 },
          { x: cx - 8, y: cy - 4, score: 0.9 },
          { x: cx + 8, y: cy - 4, score: 0.9 },
          { x: cx, y: cy + 12, score: 0.9 },
        ],
      },
    ]);
  }
  const pose: PoseModel = { skeleton: { name: "test-injection-skeleton", nodes, edges }, tracks: ["mock_animal"], byFrame };
  const name = "test-injection-mock.slp";
  const video = loadedVideoMeta();
  if (!video) return;
  const meta: SlpSourceMeta = testInjection?.mismatch
    ? {
        filename: "a-different-recording.mp4",
        frames: state.totalFrames + 500,
        width: state.width * 3,
        height: state.height * 3,
        fps: state.fps,
        maxLabeledFrame: state.totalFrames - 1,
        videoCount: 1,
        seriesLength: null,
      }
    : {
        filename: video.name,
        frames: video.frames,
        width: video.width,
        height: video.height,
        fps: video.fps,
        maxLabeledFrame: state.totalFrames - 1,
        videoCount: 1,
        seriesLength: null,
      };
  const mismatches = slpVideoMismatches(meta, video);
  if (mismatches.length) {
    rejectSlp(name, ".slp", video, mismatches);
    return;
  }
  state.pose = pose;
  state.slpFile = null;
  state.poseUrl = null;
  state.slpMeta = meta;
  state.slpName = name;
  state.slpKind = ".slp";
  poseGeneration++;
  clearDeliveryOutcomes();
  els.slpBadge.textContent = `${byFrame.size} frames`;
  els.slpBadge.className = "badge ok";
  els.slpError.hidden = true;
  els.slpStatus.hidden = false;
  showSlpWarnings(name, video, slpVideoWarnings(meta, video, ".slp"));
  renderFrame();
  syncUrl();
}

// `?test&remote_listing=N` fakes what the browse pane would show, but the pane itself is only ever
// opened by hand — so on its own the fake listing would sit unseen behind the local-file dropzone.
// Switching to it here is what makes the URL alone the whole smoketest.
if (testInjection?.remoteListing !== null && testInjection?.remoteListing !== undefined) {
  selectSeg(els.srcSeg, "browse");
  setSrcPane("browse");
}

void initFromUrl().then(() => void applyMockVideo());

log("Ready. Load a local video or stream one from EMBER to begin.");
