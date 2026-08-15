import "./style.css";
import * as sio from "@talmolab/sleap-io.js";
import { getElements } from "./ui/elements";
import { bytes, fmtTime, rulerLabel } from "./lib/format";
import {
  frameAt,
  fractionOf,
  hourMarks,
  offersWindowChoice,
  rigidShift,
  rulerMarks,
  usesWindow,
  windowFor,
  windowHalfFrames,
  windowHalfSeconds,
  DEFAULT_WINDOW_HALF_SECONDS,
  type TimelineView,
} from "./lib/timeline";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "./lib/video";
import { openStreamingBlob, openStreamingUrl, StreamingVideoBackend } from "./lib/streaming";
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
import {
  blurSigma,
  clampRegion,
  defaultBlurRadius,
  frameFit,
  maxBlurRadius,
  paintBlurRegions,
  MIN_BLUR_RADIUS,
  type BlurRegion,
} from "./lib/blur";
import { containsHumanSubjects, fetchDraftMetadata } from "./lib/humanSubjects";
import { ensureFreshToken, handleRedirectCallback, revokeToken, startLogin } from "./lib/oauth";
import { listIncomingDandisets, type IncomingDandiset } from "./lib/dandisets";
import { loadStoredSettings, resolveConfig, saveStoredSettings } from "./lib/settings";
import {
  defaultDeliveryMode,
  fileBrowserUrl,
  selectionDirectory,
  uploadAssetPath,
  uploadDirectory,
  uploadOriginalPath,
  type DeliveryMode,
  type SelectionKind,
} from "./lib/delivery";
import {
  bundleFileName,
  extractClip,
  extractFrame,
  extractOverlay,
  provenanceFileName,
  type AssetEntities,
  type ExtractedMedia,
  type ExtractProgress,
} from "./lib/extract";
import { tarGzip, type BundleEntry } from "./lib/bundle";
import { memoOne } from "./lib/memo";
import { checksumBlob, uploadAsset, type BlobDigest, type UploadPhase } from "./lib/upload";
import { buildProvenance, type ProvenanceAnnotationsInput } from "./lib/provenance";
import { countLabeledFramesInRange } from "./lib/annotations";
import { fetchArchiveUser, type ArchiveUser } from "./lib/users";
import { friendlyError } from "./lib/errors";
import { renderIdentity } from "./ui/connection";
import { saveBlob } from "./ui/download";
import type { ArchiveConfig, OAuthTokenSet, PoseModel, SleapLabels, SleapVideoBackend } from "./lib/types";

// Injected at build time from package.json's version (see configs/appVersion.ts).
declare const __APP_VERSION__: string;

const els = getElements();

els.versionIndicator.textContent = `v${__APP_VERSION__}`;

// Load/seek diagnostics go to the browser console — the interface deliberately has no on-page
// log panel.
type LogClass = "err" | "ok" | "warn" | "";
function log(msg: string, cls: LogClass = ""): void {
  if (cls === "err") console.error(msg);
  else if (cls === "warn") console.warn(msg);
  else console.info(msg);
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
// "video" selects an in/out range (streamed directly, no re-encoding); "frame" selects a single
// frame. The mode only changes what the selector means — playback works the same in both.
type SelectorMode = "video" | "frame";

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
  cur: number;
  inF: number | null;
  outF: number | null;
  playing: boolean;
  speed: number;
  pose: PoseModel | null;
  /** The pose file behind `pose`, when it came from a local file — kept so it can ride along with
   * an upload. Null for one fetched from a URL, whose bytes were never held locally. */
  slpFile: File | null;
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
  cur: 0,
  inF: null,
  outF: null,
  playing: false,
  speed: 1,
  pose: null,
  slpFile: null,
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

/** A throttled reporter for how much of `name` has been read while it is being opened. */
function indexProgress(name: string): (bytesRead: number) => void {
  let last = 0;
  return (bytesRead) => {
    const now = Date.now();
    if (now - last < INDEX_PROGRESS_MS) return;
    last = now;
    log(`Reading ${name}'s index… ${bytes(bytesRead)} so far`);
  };
}

/** Opens bytes already in hand, falling back through sleap-io.js's backends: its MediaBunny one
 * reads the whole file to index it (see lib/streaming.ts), which is slow but not wrong, and its
 * mp4box one covers files MediaBunny will not open at all. */
async function openLocalBackend(file: File, name: string): Promise<SleapVideoBackend> {
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

async function openVideoBackend(source: File | string, name: string): Promise<OpenedSource> {
  if (typeof source === "string") {
    try {
      const backend = await openStreamingUrl(source, { cacheSize: FRAME_CACHE_SIZE, onIndexProgress: indexProgress(name) });
      return { backend, file: null };
    } catch (e) {
      log(`Range/stream open failed (${(e as Error).message}); downloading full file…`, "warn");
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching video`);
      const blob = await resp.blob();
      const file = new File([blob], name, { type: blob.type || "video/mp4" });
      return { backend: await openLocalBackend(file, name), file };
    }
  }
  return { backend: await openLocalBackend(source, name), file: source };
}

async function loadVideo(source: File | string, name: string, url: string | null = null): Promise<void> {
  stopPlay();
  log(`Loading video: ${name}…`);
  try {
    const { backend, file } = await openVideoBackend(source, name);
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
    // loadVideo fully owns source state: this is either the dropped File, the one the stream
    // fallback materialized, or null for a live-streamed URL — never a previous load's leftover.
    state.sourceFile = file;
    sourceGeneration++;
    clearDeliveryOutcomes();
    state.cur = 0;
    state.inF = null;
    state.outF = null;
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
    await seek(0, true);
    updateSelUI();
  } catch (e) {
    log(`Video error: ${(e as Error).message}`, "err");
    console.error(e);
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
  state.slpName = null;
  state.slpKind = null;
  state.slpMeta = null;
  poseGeneration++;
  clearDeliveryOutcomes();
  els.slpStatus.hidden = true;
  // Nothing is loaded, so there is no pair left to caution anyone about.
  els.slpWarning.hidden = true;
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
    return;
  }
  seeking = true;
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
  seeking = false;
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
function selRange(): [number, number] {
  const a = state.inF != null ? state.inF : 0;
  const b = state.outF != null ? state.outF : state.totalFrames - 1;
  return [Math.min(a, b), Math.max(a, b)];
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

/** Slides the playhead and either marked end by `travel`, as one piece. Bounded by whichever of
 * them would leave the recording first, so the range keeps its length at the ends of the video. */
function shiftMarkers(travel: number): void {
  const marks = [state.cur, state.inF, state.outF].filter((m): m is number => m != null);
  const shift = rigidShift(marks, travel, state.totalFrames);
  if (shift === 0) return;
  state.cur += shift;
  if (state.inF != null) state.inF += shift;
  if (state.outF != null) state.outF += shift;
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

/** Shows or hides the overview, and lays out its gradations for what it now spans. The bar is only
 * there for a recording longer than the stretch the track covers: below that the track already
 * spans the whole video, and this would be a slider with nowhere to slide. Its width control goes
 * with it, from the transport row, since a width means nothing without something to move. */
function refreshOverview(): void {
  const loaded = !!state.backend;
  els.overviewWrap.hidden = !loaded || !usesWindow(state.totalFrames, halfFrames());
  // The control outlives the bar by one step: it stays for as long as any width on offer would
  // still window this recording, so picking one wide enough to cover the whole thing does not take
  // away the control that would narrow it again.
  els.windowGroup.hidden = !loaded || !offersWindowChoice(state.totalFrames, state.fps);
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
  els.overWin.style.width = `${(Math.min(at.len, state.totalFrames) / Math.max(1, state.totalFrames)) * 100}%`;
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
 * its partner collapses the range instead of silently swapping the two. */
function moveHandle(which: "in" | "out", frame: number): void {
  const [lo, hi] = selRange();
  if (which === "in") setSelection(Math.min(frame, hi), hi);
  else setSelection(lo, Math.max(frame, lo));
}

/** Marks an end at the playhead, for the `[ ] I O` shortcuts. Unlike a drag this can invalidate the
 * other end (marking In past Out), in which case that end goes back to unmarked and the range runs
 * to the boundary — which is what someone re-marking a snippet from scratch is after. */
function markIn(): void {
  state.inF = state.cur;
  if (state.outF != null && state.outF < state.inF) state.outF = null;
  selectionChanged();
}
function markOut(): void {
  state.outF = state.cur;
  if (state.inF != null && state.inF > state.outF) state.inF = null;
  selectionChanged();
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
let bandDrag: { grabbedAt: number; lo: number; hi: number } | null = null;
els.selfill.addEventListener("pointerdown", (e) => {
  if (!state.backend) return;
  e.preventDefault();
  els.selfill.setPointerCapture(e.pointerId);
  const [lo, hi] = selRange();
  bandDrag = { grabbedAt: frameAtClientX(e.clientX), lo, hi };
  stopPlay();
});
els.selfill.addEventListener("pointermove", (e) => {
  if (!bandDrag) return;
  const last = Math.max(0, state.totalFrames - 1);
  // Clamp the shift rather than either end, so sliding into a boundary stops the band there instead
  // of squashing it against the edge.
  const shift = Math.max(-bandDrag.lo, Math.min(last - bandDrag.hi, frameAtClientX(e.clientX) - bandDrag.grabbedAt));
  setSelection(bandDrag.lo + shift, bandDrag.hi + shift);
});
const releaseBand = (e: PointerEvent): void => {
  if (els.selfill.hasPointerCapture(e.pointerId)) els.selfill.releasePointerCapture(e.pointerId);
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

// Source toggle: local file (dropzone) vs stream from EMBER (URL).
type SourceKind = "local" | "ember";
function setSrcPane(src: SourceKind): void {
  els.localPane.hidden = src !== "local";
  els.emberPane.hidden = src !== "ember";
}
wireSeg(els.srcSeg, (v) => setSrcPane(v as SourceKind));

function loadFromEmberUrl(): void {
  const url = els.emberUrl.value.trim();
  if (!url) return;
  state.sourceFile = null;
  void loadVideo(url, url.split("/").pop()?.split("?")[0] || "video.mp4", url);
}
els.emberLoadBtn.addEventListener("click", loadFromEmberUrl);
els.emberUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadFromEmberUrl();
});

// SLEAP annotations step: hidden until the toggle above the player is switched on.
function enableSlpStep(): void {
  els.slpToggle.checked = true;
  els.slpCard.hidden = false;
}
els.slpToggle.addEventListener("change", () => {
  els.slpCard.hidden = !els.slpToggle.checked;
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
  state.inF = null;
  state.outF = null;
  selectionChanged();
});
els.showPose.addEventListener("change", renderFrame);

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
  } else if (state.mode === "video" && (e.key === "i" || e.key === "I" || e.key === "[")) {
    markIn();
  } else if (state.mode === "video" && (e.key === "o" || e.key === "O" || e.key === "]")) {
    markOut();
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

els.dropzone.addEventListener("click", () => els.videoFile.click());
els.slpDropzone.addEventListener("click", () => els.slpFile.click());
// stopPropagation keeps a dropzone's own click handler from also firing on the inner buttons.
els.browseVideoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.videoFile.click();
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
  const f = els.videoFile.files?.[0];
  if (f) void loadVideo(f, f.name);
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

function renderAuthUI(): void {
  const signedIn = oauthTokens !== null;
  els.oauthSigninBtn.hidden = signedIn;
  els.oauthSignedIn.hidden = !signedIn;
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
  if (!oauthTokens) {
    currentDatasets = [];
    setDandisetPlaceholder("Please sign in to see your incoming datasets.");
    updateViewDatasetLink();
    applyDeliveryMode();
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
}

async function initEmberAuth(): Promise<void> {
  const callbackTokens = await handleRedirectCallback().catch((e) => {
    log(`OAuth sign-in callback failed: ${(e as Error).message}`, "err");
    return null;
  });
  if (callbackTokens) {
    oauthTokens = callbackTokens;
    saveSettings();
    renderAuthUI();
  }
  await refreshDandisetOptions();
}

els.oauthSigninBtn.addEventListener("click", () => void startLogin());
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
 * since there would be nowhere to upload to. */
function applyDeliveryMode(): void {
  const mode = storedDeliveryMode ?? defaultDeliveryMode(currentDatasets.length);
  selectSeg(els.deliverSeg, mode);
  setDeliveryMode(mode);
}

wireSeg(els.deliverSeg, (v) => {
  storedDeliveryMode = v as DeliveryMode;
  setDeliveryMode(storedDeliveryMode);
  saveSettings();
});

// Both buttons wait on a description, so the gate is re-read as it is typed rather than on blur.
els.selectionDescription.addEventListener("input", updateDeliveryGate);
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
  return humanSubjectsRequired && oauthTokens !== null && deliveryMode === "upload" && els.dandisetId.value !== "";
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
 * not something to hand off under the name of a clip. */
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
 * delivery writes (and by the bundle that holds them). */
function currentEntities(): AssetEntities {
  const [lo, hi] = state.mode === "frame" ? [state.cur, state.cur] : selRange();
  return { sourceName: state.sourceName, mode: state.mode === "frame" ? "frame" : "snippet", inFrame: lo, outFrame: hi };
}

/** Names the file the Save button is about to produce — the name alone, since it already spells out
 * the frame or the frame range. Refreshed on every seek too, frame mode's output following the
 * current frame, hence the long-lived child element rather than rebuilt markup. */
function updateDeliveryPreview(): void {
  const show = state.backend !== null && hasSelection();
  els.downloadPreview.hidden = !show;
  if (!show) return;
  els.downloadPreviewName.textContent = bundleFileName(currentEntities());
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
      blur,
    });
  }
  return extractClip({
    sourceFile: state.sourceFile,
    sourceUrl: state.sourceUrl,
    // Only the streaming backend can cut a selection out of a source it never downloaded; the
    // sleap-io.js fallbacks hold no such thing, and fall through to ffmpeg as before.
    backend: backend instanceof StreamingVideoBackend ? backend : null,
    sourceName: entities.sourceName,
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

/** What was loaded from a `.slp`, restricted to the selection, or null when there is none. */
function annotationsSummary(lo: number, hi: number, slp: DeliveredSlp | null): ProvenanceAnnotationsInput | null {
  const pose = els.slpToggle.checked ? state.pose : null;
  if (!pose) return null;
  return {
    filename: state.slpFile?.name ?? null,
    checksum: slp?.digest.etag ?? null,
    uploaded: slp?.path != null,
    assetPath: slp?.path ?? null,
    skeletonNodeCount: pose.skeleton.nodes.length,
    trackCount: pose.tracks.length,
    labeledFramesInSelection: countLabeledFramesInRange(pose, lo, hi),
  };
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
      blur,
      onProgress,
    });
    return { media, digest: await checksumFor(media.blob, label, onProgress) };
  });
  const path = uploadAssetPath(directory, media.filename);
  await deliver({ blob: media.blob, path, contentType: media.mime, label, digest });
  return { media, path, digest };
}

/** Checksums the source video, and hands it over when the toggle asks for it. The checksum is taken
 * either way: recording which video a clip came from is only useful if that video can be identified
 * again later. */
async function deliverOriginalVideo(
  deliver: DeliverFile,
  directory: string,
  onProgress: ExtractProgress,
): Promise<{ original: File | null; originalDigest: BlobDigest | null; originalPath: string | null }> {
  const original = state.sourceFile;
  if (!original) return { original: null, originalDigest: null, originalPath: null };
  const label = "the original video";
  // Keyed to the load rather than the selection: the same bytes hash to the same digest however
  // many selections are cut out of them, and this is the hash that can take minutes.
  const originalDigest = await sourceDigestOnce(`source-${sourceGeneration}`, () => checksumFor(original, label, onProgress));
  if (!els.uploadOriginal.checked) return { original, originalDigest, originalPath: null };
  // Carried under the name it arrived with, not a derived one: it is the untouched source, and its
  // verbatim name is what the provenance record reports.
  const originalPath = uploadOriginalPath(directory, original.name);
  await deliver({
    blob: original,
    path: originalPath,
    contentType: original.type || "video/mp4",
    label,
    digest: originalDigest,
  });
  return { original, originalDigest, originalPath };
}

/** Same for a loaded `.slp`: it is original content too, so it rides along on the same toggle, and is
 * checksummed either way. */
async function deliverAnnotationFile(deliver: DeliverFile, directory: string, onProgress: ExtractProgress): Promise<DeliveredSlp | null> {
  const slpFile = state.slpFile;
  if (!slpFile) return null;
  const label = "the annotations";
  const digest = await annotationDigestOnce(`pose-${poseGeneration}`, () => checksumFor(slpFile, label, onProgress));
  if (!els.uploadOriginal.checked) return { digest, path: null };
  const path = uploadOriginalPath(directory, slpFile.name);
  await deliver({ blob: slpFile, path, contentType: slpFile.type || "application/octet-stream", label, digest });
  return { digest, path };
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
  /** The archive the files are bound for, read after `onReady`; null for a bundle saved locally,
   * which is not bound for one. */
  destination: () => { api: string; dandisetId: string; user: ArchiveUser | null } | null;
  deliver: DeliverFile;
  onProgress: ExtractProgress;
}

interface AssembledSelection {
  entities: AssetEntities;
  directory: string;
  createdAt: Date;
}

/**
 * Extracts the current selection and hands every file it produces to `deliver`, in the order they
 * are meant to land: the selection itself, its pose overlay, the original content, then the
 * provenance record naming them all. Both routes come through here, which is what makes a saved
 * bundle hold exactly what an upload would have written.
 */
async function assembleSelection(params: AssembleParams): Promise<AssembledSelection> {
  const { backend, deliver, onProgress } = params;
  const entities = currentEntities();
  const { mode: kind, inFrame: lo, outFrame: hi } = entities;
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
  const destination = params.destination();
  // One instant for the whole delivery, so the directory's date/time entities and the provenance
  // record's `created_at` name the same moment. Under the archive's upload root for an upload; the
  // bare directory for a bundle, which is a folder on someone's computer, not a dandiset.
  const createdAt = new Date();
  const directory = destination ? uploadDirectory(createdAt, kind) : selectionDirectory(createdAt, kind);

  // The extracted selection goes first: it is the point of the delivery, and the original — which
  // can be orders of magnitude larger — is a recommended companion, not a prerequisite for it.
  const mediaPath = uploadAssetPath(directory, media.filename);
  await deliver({ blob: media.blob, path: mediaPath, contentType: media.mime, label: `the ${kind}`, digest: mediaDigest });

  const overlay = await deliverOverlay(deliver, directory, entities, backend, blur, onProgress);
  const { original, originalDigest, originalPath } = await deliverOriginalVideo(deliver, directory, onProgress);
  const slp = await deliverAnnotationFile(deliver, directory, onProgress);

  const provenance = buildProvenance({
    createdAt,
    pageUrl: location.href.split("?")[0],
    description: els.selectionDescription.value,
    user: destination?.user ?? null,
    api: destination?.api ?? null,
    dandisetId: destination?.dandisetId ?? null,
    directory,
    mode: kind,
    fps: state.fps,
    width: state.width,
    height: state.height,
    totalFrames: state.totalFrames,
    inFrame: lo,
    outFrame: hi,
    blur,
    blurSigma: blurSigma(blur),
    source: {
      filename: state.sourceName,
      url: state.sourceUrl,
      sizeBytes: original?.size ?? null,
      checksum: originalDigest?.etag ?? null,
      checksumUnavailable: original ? null : "The source video was streamed from a URL, so its bytes were never held locally to hash.",
      uploaded: originalPath !== null,
      assetPath: originalPath,
    },
    extracted: {
      filename: media.filename,
      assetPath: mediaPath,
      mediaType: media.mime,
      sizeBytes: media.blob.size,
      checksum: mediaDigest.etag,
      encoding: media.encoding,
    },
    overlay: overlay && {
      filename: overlay.media.filename,
      assetPath: overlay.path,
      mediaType: overlay.media.mime,
      sizeBytes: overlay.media.blob.size,
      checksum: overlay.digest.etag,
      encoding: overlay.media.encoding,
    },
    annotations: annotationsSummary(lo, hi, slp),
  });
  const provenanceBlob = new Blob([JSON.stringify(provenance, null, 2)], { type: "application/json" });
  const provenancePath = uploadAssetPath(directory, provenanceFileName(entities));
  const label = "the provenance record";
  // The one file that is never re-used: it names this delivery's own directory and instant, so it
  // differs even when everything it describes was carried over from the last one.
  await deliver({
    blob: provenanceBlob,
    path: provenancePath,
    contentType: "application/json",
    label,
    digest: await checksumFor(provenanceBlob, label, onProgress),
  });

  return { entities, directory, createdAt };
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
    const { entities, createdAt } = await assembleSelection({
      backend,
      destination: () => null,
      onProgress: (message) => setStatus(els.downloadStatus, message),
      // Every file is hashed on its way in even though nothing is being uploaded: the provenance
      // record inside the bundle quotes the same digests an upload would have registered, so a
      // selection saved now and uploaded later is identifiable as the same bytes.
      deliver: (file) => {
        bundled.push({ path: file.path, blob: file.blob });
        return Promise.resolve();
      },
    });
    setStatus(els.downloadStatus, "Packing the bundle…");
    const bundle = await tarGzip(bundled, createdAt);
    const filename = bundleFileName(entities);
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
    const { directory } = await assembleSelection({
      backend,
      onReady: async () => {
        // Refresh the token before the first request rather than mid-transfer, where an expiry would
        // strand a half-finished multipart upload.
        await ensureFreshOAuth();
        const cfg = currentConfig();
        if (!cfg.dandisetId) throw new Error("Pick an upload destination first.");
        // The provenance record names the uploader, so resolve the account here if the header's own
        // lookup has not landed (or was never made) yet.
        currentUser ??= await fetchArchiveUser(cfg).catch(() => null);
      },
      destination: () => {
        const cfg = currentConfig();
        return { api: cfg.api, dandisetId: cfg.dandisetId, user: currentUser };
      },
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
    // link goes straight to this upload's own directory in the archive's file browser.
    setStatusLink(
      els.uploadStatus,
      "Upload complete - ",
      fileBrowserUrl(cfg.web, cfg.dandisetId, directory),
      "click here to view and share",
      "ok",
    );
    log(`Upload complete: ${directory}/`, "ok");
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
void initEmberAuth();

// URL params: ?url=<video>&pose=<.slp or .nwb> (?slp= is the older spelling of the same thing)
function initFromUrlParams(): void {
  const p = new URLSearchParams(location.search);
  const url = p.get("url");
  if (url) {
    // A remote URL is the EMBER-stream path — reflect it in the source toggle.
    selectSeg(els.srcSeg, "ember");
    setSrcPane("ember");
    els.emberUrl.value = url;
    void loadVideo(url, url.split("/").pop() || "video.mp4", url);
  }
  const pose = p.get("pose") ?? p.get("slp");
  if (pose) setTimeout(() => void loadPoseFile(pose, pose.split("/").pop() || "labels.slp"), 600);
}
initFromUrlParams();

log("Ready. Load a local video or stream one from EMBER to begin.");
