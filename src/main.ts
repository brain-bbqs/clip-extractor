import "./style.css";
import * as sio from "@talmolab/sleap-io.js";
import { getElements } from "./ui/elements";
import { createLogger } from "./ui/log";
import { renderKv } from "./ui/kv";
import { fmtTime } from "./lib/format";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "./lib/video";
import { drawPose, labelsToPose } from "./lib/pose";
import type { PoseModel, SleapLabels, SleapVideoBackend } from "./lib/types";

const els = getElements();
const log = createLogger(els.log);
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
  mode: "video",
  curBitmap: null,
};

// ============================================================
// Video loading (remote URL + local file)
// ============================================================
async function openVideoBackend(source: File | string, name: string): Promise<SleapVideoBackend> {
  if (typeof source === "string") {
    try {
      return await sio.MediaBunnyVideoBackend.fromUrl(source, { cacheSize: 96 });
    } catch (e) {
      log(`Range/stream open failed (${(e as Error).message}); downloading full file…`, "warn");
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching video`);
      const blob = await resp.blob();
      state.sourceFile = new File([blob], name, { type: blob.type || "video/mp4" });
      return await sio.MediaBunnyVideoBackend.fromBlob(state.sourceFile, name, {
        cacheSize: 96,
      });
    }
  }
  try {
    return await sio.MediaBunnyVideoBackend.fromBlob(source, name, { cacheSize: 96 });
  } catch (e) {
    log(`MediaBunny failed (${(e as Error).message}); trying mp4box…`, "warn");
    const vb = await sio.createVideoBackend(source, { backend: "mp4box" });
    const maybeReady = (vb as { ready?: Promise<unknown> }).ready;
    if (maybeReady) await maybeReady;
    return vb;
  }
}

async function loadVideo(source: File | string, name: string, url: string | null = null): Promise<void> {
  stopPlay();
  log(`Loading video: ${name}…`);
  try {
    const backend = await openVideoBackend(source, name);
    state.backend = backend;
    state.frameOrder = await buildFrameOrder(backend);
    const shape = backend.shape ?? [];
    state.height = shape[1] || backend.height || 0;
    state.width = shape[2] || backend.width || 0;
    state.totalFrames = backend.numFrames ?? shape.at(0) ?? 0;
    state.fps = backend.fps || 30;
    state.sourceName = name;
    state.sourceUrl = url;
    // loadVideo fully owns source state: clear any prior local File on a URL load.
    state.sourceFile = source instanceof File ? source : null;
    state.cur = 0;
    state.inF = null;
    state.outF = null;
    els.view.width = state.width;
    els.view.height = state.height;
    els.emptyStage.style.display = "none";
    els.view.style.display = "block";
    els.overlayInfo.style.display = "block";
    enablePlayer(true);
    log(`Loaded ${state.width}×${state.height}, ${state.totalFrames} frames @ ${state.fps.toFixed(2)} fps`, "ok");
    await seek(0, true);
    refreshSource();
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
    const nFrames = state.pose.byFrame.size;
    log(`SLP loaded: ${state.pose.skeleton.nodes.length} nodes, ${state.pose.tracks.length} tracks, ${nFrames} labeled frames`, "ok");
    els.slpBadge.textContent = `${nFrames} frames`;
    els.slpBadge.className = "badge ok";
    els.slpBadge.hidden = false;
    els.showPoseWrap.hidden = false;
    refreshSource();
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
      if (typeof state.backend.prefetch === "function") {
        // Decode order may be locally reordered (B-frames), so bound the range by min/max.
        const a = decodeIndex(state.frameOrder, target);
        const b = decodeIndex(state.frameOrder, Math.min(state.totalFrames - 1, target + 30));
        state.backend.prefetch(Math.min(a, b), Math.max(a, b)).catch(() => {});
      }
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
  updateSelUI();
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
  if (state.mode === "frame") {
    els.rangeSummary.textContent = state.backend
      ? `Selection: frame ${state.cur} · ${fmtTime(state.cur, state.fps)}`
      : "Selection: no video loaded";
    return;
  }
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
  els.playerCard.classList.toggle("mode-frame", mode === "frame");
  els.modeHint.textContent =
    mode === "video" ? "Select an in/out range — streamed directly, no re-encoding." : "Scrub to select a single frame.";
  if (mode === "frame") {
    // A frame selection is just the current frame; drop any in/out range.
    state.inF = null;
    state.outF = null;
  }
  updateSelUI();
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
}

function refreshSource(): void {
  if (!state.backend) {
    els.srcInfo.hidden = true;
    return;
  }
  els.srcInfo.hidden = false;
  renderKv(els.srcInfo, [
    ["Video", state.sourceName],
    ["Resolution", `${state.width}×${state.height}`],
    ["Frames", state.totalFrames],
    ["FPS", state.fps.toFixed(2)],
    ["Reorder", state.frameOrder ? "B-frames (remapped)" : "in order"],
    ["SLP", state.pose ? `${state.pose.tracks.length} tracks / ${state.pose.skeleton.nodes.length} nodes` : "none"],
  ]);
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
// (e.g. a ?url= param selecting the EMBER pane).
function selectSeg(segEl: HTMLElement, value: string | undefined): void {
  segEl.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Object.values(b.dataset)[0] === value));
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
  updateSelUI();
});
els.btnSetOut.addEventListener("click", () => {
  state.outF = state.cur;
  if (state.inF != null && state.inF > state.outF) state.inF = null;
  updateSelUI();
});
els.btnClearSel.addEventListener("click", () => {
  state.inF = null;
  state.outF = null;
  updateSelUI();
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
