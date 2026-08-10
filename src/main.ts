import "./style.css";
import * as sio from "@talmolab/sleap-io.js";
import { getElements } from "./ui/elements";
import { bytes, fmtTime } from "./lib/format";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "./lib/video";
import { drawPose, labelsToPose } from "./lib/pose";
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

const els = getElements();

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
  /** The `.slp` behind `pose`, when it came from a local file — kept so it can ride along with an
   * upload. Null for a `.slp` fetched from a URL, whose bytes were never held locally. */
  slpFile: File | null;
  mode: SelectorMode;
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
  mode: "video",
  curBitmap: null,
};

// Bumped by every successful load, so anything derived from the bytes behind the player (or behind
// the pose) can be keyed to the load it came from — two files can share a name, and re-dropping an
// edited one must not look like the same source. See the delivery caches below.
let sourceGeneration = 0;
let poseGeneration = 0;

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

async function openVideoBackend(source: File | string, name: string): Promise<OpenedSource> {
  if (typeof source === "string") {
    try {
      return { backend: await sio.MediaBunnyVideoBackend.fromUrl(source, { cacheSize: FRAME_CACHE_SIZE }), file: null };
    } catch (e) {
      log(`Range/stream open failed (${(e as Error).message}); downloading full file…`, "warn");
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching video`);
      const blob = await resp.blob();
      const file = new File([blob], name, { type: blob.type || "video/mp4" });
      return { backend: await sio.MediaBunnyVideoBackend.fromBlob(file, name, { cacheSize: FRAME_CACHE_SIZE }), file };
    }
  }
  try {
    return { backend: await sio.MediaBunnyVideoBackend.fromBlob(source, name, { cacheSize: FRAME_CACHE_SIZE }), file: source };
  } catch (e) {
    log(`MediaBunny failed (${(e as Error).message}); trying mp4box…`, "warn");
    const vb = await sio.createVideoBackend(source, { backend: "mp4box" });
    const maybeReady = (vb as { ready?: Promise<unknown> }).ready;
    if (maybeReady) await maybeReady;
    return { backend: vb, file: source };
  }
}

async function loadVideo(source: File | string, name: string, url: string | null = null): Promise<void> {
  stopPlay();
  log(`Loading video: ${name}…`);
  try {
    const { backend, file } = await openVideoBackend(source, name);
    state.backend = backend;
    state.frameOrder = await buildFrameOrder(backend);
    const shape = backend.shape ?? [];
    state.height = shape[1] || backend.height || 0;
    state.width = shape[2] || backend.width || 0;
    state.totalFrames = backend.numFrames ?? shape.at(0) ?? 0;
    state.fps = backend.fps || 30;
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
    prefetched = null;
    prefetchInFlight = false;
    els.view.width = state.width;
    els.view.height = state.height;
    els.emptyStage.style.display = "none";
    els.view.style.display = "block";
    els.overlayInfo.style.display = "block";
    enablePlayer(true);
    log(`Loaded ${state.width}×${state.height}, ${state.totalFrames} frames @ ${state.fps.toFixed(2)} fps`, "ok");
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
async function loadSlp(source: File | string, name: string): Promise<void> {
  // A .slp can arrive via the main dropzone or a URL param while the annotations step is still
  // toggled off — reveal the step so the load has somewhere visible to land.
  enableSlpStep();
  log(`Parsing SLP: ${name}…`);
  try {
    const labels = (await sio.loadSlp(source, { openVideos: false })) as unknown as SleapLabels;
    state.pose = labelsToPose(labels);
    // Only after a successful parse: a file this app could not read is not one to hand to the
    // archive.
    state.slpFile = source instanceof File ? source : null;
    poseGeneration++;
    clearDeliveryOutcomes();
    const nFrames = state.pose.byFrame.size;
    log(`SLP loaded: ${state.pose.skeleton.nodes.length} nodes, ${state.pose.tracks.length} tracks, ${nFrames} labeled frames`, "ok");
    els.slpBadge.textContent = `${nFrames} frames`;
    els.slpBadge.className = "badge ok";
    els.slpStatus.hidden = false;
    renderFrame();
  } catch (e) {
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
  if (state.pose && els.slpToggle.checked && els.showPose.checked)
    drawPose(ctx, state.pose.byFrame.get(state.cur), state.pose.skeleton, state.width);
  els.overlayInfo.textContent = `frame ${state.cur} / ${state.totalFrames - 1}  ·  ${fmtTime(state.cur, state.fps)}`;
}

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

async function seek(frame: number, force = false): Promise<void> {
  frame = Math.max(0, Math.min(state.totalFrames - 1, frame | 0));
  if (shiftHeld && state.mode === "video") growSelection(frame);
  if (frame === state.cur && !force && state.curBitmap) return;
  state.cur = frame;
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
    const end = state.outF != null ? state.outF : state.totalFrames - 1;
    if (next > end) next = state.inF != null ? state.inF : 0;
    void seek(next);
  }
  rafId = requestAnimationFrame(playLoop);
}
function startPlay(): void {
  if (state.playing || !state.backend) return;
  state.playing = true;
  lastT = 0;
  accum = 0;
  els.btnPlay.innerHTML = "&#10073;&#10073; Pause";
  rafId = requestAnimationFrame(playLoop);
}
function stopPlay(): void {
  state.playing = false;
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
  els.btnPlay.innerHTML = "&#9654; Play";
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

function updateSelUI(): void {
  els.frameSlider.value = String(state.cur);
  els.curVal.textContent = String(state.cur);
  els.inVal.textContent = state.inF != null ? String(state.inF) : "—";
  els.outVal.textContent = state.outF != null ? String(state.outF) : "—";
  const tf = state.totalFrames || 1;
  const den = Math.max(1, tf - 1); // avoid 0/0 → NaN% for a single-frame video
  const [lo, hi] = selRange();
  if (state.inF != null || state.outF != null) {
    els.selfill.style.display = "block";
    els.selfill.style.left = `${(lo / den) * 100}%`;
    els.selfill.style.width = `${((hi - lo) / den) * 100}%`;
  } else {
    els.selfill.style.display = "none";
  }
  els.selplay.style.display = state.backend ? "block" : "none";
  els.selplay.style.left = `${(state.cur / den) * 100}%`;
  // Frame mode's output name tracks the current frame, so the preview follows every seek.
  if (!deliveryBusy) {
    updateDeliveryPreview();
    // In frame mode the playhead *is* the selection, so moving it retires an outcome describing
    // where the last frame went. (A snippet's in/out points go through selectionChanged instead.)
    if (state.mode === "frame") clearDeliveryOutcomes();
  }
  // Frame mode has no range summary — the current frame is already shown in the stage overlay.
  if (state.mode === "frame") return;
  const n = hi - lo + 1;
  els.rangeSummary.textContent =
    state.inF == null && state.outF == null
      ? `Selection: full video (${state.totalFrames} frames)`
      : `Selection: frames ${lo}–${hi} · ${n} frames · ${(n / state.fps).toFixed(2)}s`;
}

// ============================================================
// Selector mode (video vs frame)
// ============================================================
function setMode(mode: SelectorMode): void {
  state.mode = mode;
  clearDeliveryOutcomes();
  els.playerCard.classList.toggle("mode-frame", mode === "frame");
  if (mode === "frame") {
    // A frame selection is just the current frame; drop any in/out range.
    state.inF = null;
    state.outF = null;
  }
  updateSelUI();
  // The delivery card names what it will produce (MP4 vs PNG), so it follows the selector mode.
  updateDeliveryGate();
}

// ============================================================
// UI wiring
// ============================================================
function enablePlayer(on: boolean): void {
  for (const b of [els.btnFirst, els.btnPrev, els.btnPlay, els.btnNext, els.btnLast, els.btnSetIn, els.btnSetOut, els.btnClearSel]) {
    b.disabled = !on;
  }
  els.frameSlider.disabled = !on;
  els.frameSlider.max = String(Math.max(0, state.totalFrames - 1));
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
els.btnFirst.addEventListener("click", () => {
  stopPlay();
  void seek(0);
});
els.btnLast.addEventListener("click", () => {
  stopPlay();
  void seek(state.totalFrames - 1);
});
els.btnPrev.addEventListener("click", () => {
  stopPlay();
  void seek(state.cur - 1);
});
els.btnNext.addEventListener("click", () => {
  stopPlay();
  void seek(state.cur + 1);
});
els.speed.addEventListener("change", () => {
  state.speed = parseFloat(els.speed.value);
});
els.frameSlider.addEventListener("input", () => {
  stopPlay();
  void seek(parseInt(els.frameSlider.value, 10));
});
els.btnSetIn.addEventListener("click", () => {
  state.inF = state.cur;
  if (state.outF != null && state.outF < state.inF) state.outF = null;
  selectionChanged();
});
els.btnSetOut.addEventListener("click", () => {
  state.outF = state.cur;
  if (state.inF != null && state.inF > state.outF) state.inF = null;
  selectionChanged();
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

// Keyboard shortcuts. The seek slider (<input type=range>) is allowed through so [ ] I O / space
// work while it's focused; only text fields, checkboxes, and selects suppress them.
window.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return;
  if (tag === "INPUT" && (t as HTMLInputElement).type !== "range") return;
  if (!state.backend) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    // On the slider itself the native arrow keys already step it (which seeks via the input
    // handler); handling it again here would double-step.
    if (t === els.frameSlider) return;
    e.preventDefault();
    stopPlay();
    void seek(state.cur + (e.code === "ArrowRight" ? 1 : -1));
  } else if (state.mode === "video" && (e.key === "i" || e.key === "I" || e.key === "[")) {
    els.btnSetIn.click();
  } else if (state.mode === "video" && (e.key === "o" || e.key === "O" || e.key === "]")) {
    els.btnSetOut.click();
  }
});

// ============================================================
// File loading (dropzone mirrors bbqs-uploader's picker)
// ============================================================
function loadDroppedFile(f: File): void {
  if (/\.(slp|h5|hdf5)$/i.test(f.name)) void loadSlp(f, f.name);
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
  if (f) void loadSlp(f, f.name);
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
  await loadSlp(`${base}slp-viewer/mice.tracked.slp`, "mice.tracked.slp");
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
// True from the press of Upload until that upload either fails or is retired by a change to what it
// sent. While it is set the button is gone rather than merely disabled: the upload is either still
// running or already done, and in neither case is pressing it again the thing to do.
let uploadSubmitted = false;

function setDeliveryMode(mode: DeliveryMode): void {
  els.downloadPane.hidden = mode !== "download";
  els.uploadPane.hidden = mode !== "upload";
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

function setStatus(el: HTMLElement, message: string, cls: "" | "ok" | "err" = ""): void {
  el.textContent = message;
  el.className = cls ? `hint ${cls}` : "hint";
}

/** Same, followed by a link — so an outcome can hand over somewhere to go next. */
function setStatusLink(el: HTMLElement, message: string, href: string, linkText: string, cls: "" | "ok" | "err" = ""): void {
  const link = document.createElement("a");
  link.href = href;
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
  els.dandisetEmbargoError.hidden = !notEmbargoed;
  els.btnDownload.disabled = deliveryBusy || !hasVideo || !selected || !described;
  els.btnUpload.disabled = deliveryBusy || !hasVideo || !selected || !described || !cfg.dandisetId || notEmbargoed;
  els.btnUpload.hidden = uploadSubmitted;
  updateDeliveryCopy(kind);
  // Original content can only ride along when its bytes are already in the browser; a range-streamed
  // URL is remote-hosted already, and re-fetching a whole video to push it back is not worth it.
  const canSendOriginal = state.sourceFile !== null || state.slpFile !== null;
  els.uploadOriginalRow.hidden = !canSendOriginal;
  els.uploadOriginalNote.hidden = canSendOriginal || !hasVideo;
  if (deliveryBusy) return;
  updateDeliveryPreview();
  // Only ever says why the button is unavailable; a ready button needs no caption.
  const blocked = !hasVideo
    ? "Load a video to extract a selection."
    : !selected
      ? "Mark an in or out point on the player to select a snippet."
      : !described
        ? `Describe the ${kind} above before sending it on.`
        : "";
  // A finished delivery's own line outranks these captions until it is retired.
  if (!showsOutcome(els.downloadStatus)) setStatus(els.downloadStatus, blocked);
  if (!showsOutcome(els.uploadStatus)) {
    setStatus(els.uploadStatus, blocked || (!cfg.dandisetId ? "Pick an upload destination above." : ""));
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
}

/** Extracts the selection `entities` names: an MP4 snippet, or a single PNG frame. Driven by the
 * entities rather than by live state, so scrubbing on while an extraction runs cannot move what is
 * being extracted out from under the name it is being written as. */
async function extractSelection(backend: SleapVideoBackend, entities: AssetEntities, onProgress: ExtractProgress): Promise<ExtractedMedia> {
  if (entities.mode === "frame") {
    onProgress(`Encoding frame ${entities.inFrame}…`);
    return extractFrame({
      backend,
      frameOrder: state.frameOrder,
      frame: entities.inFrame,
      width: state.width,
      height: state.height,
      sourceName: entities.sourceName,
    });
  }
  return extractClip({
    sourceFile: state.sourceFile,
    sourceUrl: state.sourceUrl,
    sourceName: entities.sourceName,
    lo: entities.inFrame,
    hi: entities.outFrame,
    fps: state.fps,
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

/** What an extraction was made from: which load of which video, and which frames of it. */
function selectionKey(entities: AssetEntities): string {
  return `source-${sourceGeneration}|${entities.mode}|${entities.inFrame}|${entities.outFrame}`;
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
  // Re-used when this selection has already been extracted — saving a bundle and then uploading it
  // encodes nothing the second time round.
  const { media, digest: mediaDigest } = await extractOnce(selectionKey(entities), async () => {
    const media = await extractSelection(backend, entities, onProgress);
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

  const overlay = await deliverOverlay(deliver, directory, entities, backend, onProgress);
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

// URL params: ?url=<video>&slp=<slp>
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
  const slp = p.get("slp");
  if (slp) setTimeout(() => void loadSlp(slp, slp.split("/").pop() || "labels.slp"), 600);
}
initFromUrlParams();

log("Ready. Load a local video or stream one from EMBER to begin.");
