import "./style.css";
import * as sio from "@talmolab/sleap-io.js";
import { getElements } from "./ui/elements";
import { bytes, fmtTime } from "./lib/format";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "./lib/video";
import { drawPose, labelsToPose } from "./lib/pose";
import { ensureFreshToken, handleRedirectCallback, revokeToken, startLogin } from "./lib/oauth";
import { listIncomingDandisets, type IncomingDandiset } from "./lib/dandisets";
import { loadStoredSettings, resolveConfig, saveStoredSettings } from "./lib/settings";
import { defaultDeliveryMode, uploadAssetPath, uploadDirectory, type DeliveryMode } from "./lib/delivery";
import { extractClip, extractFrame, type ExtractedMedia, type ExtractProgress } from "./lib/extract";
import { uploadAsset, type UploadPhase } from "./lib/upload";
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
/** An opened source plus the local bytes behind it, if any: `file` is null only for a URL that is
 * genuinely being range-streamed, so extraction and the "upload the original too" option can tell
 * "bytes in hand" from "would have to be fetched". */
interface OpenedSource {
  backend: SleapVideoBackend;
  file: File | null;
}

async function openVideoBackend(source: File | string, name: string): Promise<OpenedSource> {
  if (typeof source === "string") {
    try {
      return { backend: await sio.MediaBunnyVideoBackend.fromUrl(source, { cacheSize: 96 }), file: null };
    } catch (e) {
      log(`Range/stream open failed (${(e as Error).message}); downloading full file…`, "warn");
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching video`);
      const blob = await resp.blob();
      const file = new File([blob], name, { type: blob.type || "video/mp4" });
      return { backend: await sio.MediaBunnyVideoBackend.fromBlob(file, name, { cacheSize: 96 }), file };
    }
  }
  try {
    return { backend: await sio.MediaBunnyVideoBackend.fromBlob(source, name, { cacheSize: 96 }), file: source };
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

function loadAuthSettings(): void {
  const s = loadStoredSettings();
  if (!s) return;
  if (s.dandisetId) storedDandisetId = s.dandisetId;
  if (s.oauth) oauthTokens = s.oauth;
}

function saveAuthSettings(): void {
  saveStoredSettings({ dandisetId: els.dandisetId.value.trim(), oauth: oauthTokens ?? undefined });
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
    saveAuthSettings();
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
    applyDefaultDeliveryMode();
    return;
  }
  await ensureFreshOAuth();
  void renderIdentity(els, currentConfig());
  setDandisetPlaceholder("Loading your incoming datasets…");
  try {
    const { datasets, unverified } = await listIncomingDandisets(currentConfig());
    applyDatasetList(datasets, unverified);
  } catch (e) {
    log(`Could not load your datasets: ${(e as Error).message}`, "err");
    currentDatasets = [];
    setDandisetPlaceholder("Could not load your datasets");
  }
  saveAuthSettings();
  updateViewDatasetLink();
  applyDefaultDeliveryMode();
}

async function initEmberAuth(): Promise<void> {
  const callbackTokens = await handleRedirectCallback().catch((e) => {
    log(`OAuth sign-in callback failed: ${(e as Error).message}`, "err");
    return null;
  });
  if (callbackTokens) {
    oauthTokens = callbackTokens;
    saveAuthSettings();
    renderAuthUI();
  }
  await refreshDandisetOptions();
}

els.oauthSigninBtn.addEventListener("click", () => void startLogin());
els.oauthSignoutBtn.addEventListener("click", () => {
  const tokens = oauthTokens;
  oauthTokens = null;
  saveAuthSettings();
  renderAuthUI();
  if (tokens) void revokeToken(tokens);
  void refreshDandisetOptions();
});
els.dandisetId.addEventListener("change", () => {
  updateDeliveryGate();
  updateViewDatasetLink();
  saveAuthSettings();
});

// ============================================================
// Delivery: download the extracted selection, or upload it to EMBER
// ============================================================
// Extraction runs on demand, when either button is pressed, so what leaves the page always matches
// the selection currently on screen — there is no stale "extracted" artifact to invalidate.

// Set once the visitor picks a side themselves, after which sign-in state no longer moves the
// toggle under them.
let deliveryChosen = false;
// Guards both actions while an extraction or upload is in flight.
let deliveryBusy = false;

function setDeliveryMode(mode: DeliveryMode): void {
  els.downloadPane.hidden = mode !== "download";
  els.uploadPane.hidden = mode !== "upload";
  updateDeliveryGate();
}

/** Upload leads whenever it is actually usable (signed in, with at least one incoming dataset);
 * otherwise Download does, since there would be nowhere to upload to. */
function applyDefaultDeliveryMode(): void {
  if (deliveryChosen) return;
  const mode = defaultDeliveryMode(currentDatasets.length);
  selectSeg(els.deliverSeg, mode);
  setDeliveryMode(mode);
}

wireSeg(els.deliverSeg, (v) => {
  deliveryChosen = true;
  setDeliveryMode(v as DeliveryMode);
});

function setStatus(el: HTMLElement, message: string, cls: "" | "ok" | "err" = ""): void {
  el.textContent = message;
  el.className = cls ? `hint ${cls}` : "hint";
}

/** Drives the single progress bar in the upload pane; null hides it. */
function setUploadProgress(fraction: number | null, done = false): void {
  els.uploadProgress.hidden = fraction === null;
  els.uploadProgressFill.style.width = `${Math.min(100, Math.max(0, (fraction ?? 0) * 100)).toFixed(1)}%`;
  els.uploadProgressFill.className = done ? "progress-fill ok" : "progress-fill";
}

// Enablement, the embargo warning, and both panes' idle copy, all derived from the current video,
// selector mode, and destination.
function updateDeliveryGate(): void {
  const cfg = currentConfig();
  const hasVideo = state.backend !== null;
  const notEmbargoed = cfg.embargoed === false;
  const frameMode = state.mode === "frame";
  els.dandisetEmbargoError.hidden = !notEmbargoed;
  els.btnDownload.disabled = deliveryBusy || !hasVideo;
  els.btnUpload.disabled = deliveryBusy || !hasVideo || !cfg.dandisetId || notEmbargoed;
  els.downloadHint.textContent = frameMode
    ? "Saves the selected frame to your computer as a PNG."
    : "Saves the selected snippet to your computer as a frame-exact MP4 (re-encoded by ffmpeg.wasm).";
  // The original can only ride along when its bytes are already in the browser; a range-streamed
  // URL is remote-hosted already, and re-fetching a whole video to push it back is not worth it.
  const canSendOriginal = state.sourceFile !== null;
  els.uploadOriginalRow.hidden = !canSendOriginal;
  els.uploadOriginalNote.hidden = canSendOriginal || !hasVideo;
  if (deliveryBusy) return;
  setStatus(els.downloadStatus, hasVideo ? "" : "Load a video to extract a selection.");
  setStatus(
    els.uploadStatus,
    !hasVideo
      ? "Load a video to extract a selection."
      : !cfg.dandisetId
        ? "Pick an upload destination above."
        : notEmbargoed
          ? "This destination cannot accept direct uploads."
          : `Uploads the selected ${frameMode ? "frame" : "snippet"} to the dataset above.`,
  );
}

function setDeliveryBusy(busy: boolean): void {
  deliveryBusy = busy;
  updateDeliveryGate();
}

/** Extracts whatever the selector currently points at: an MP4 snippet, or a single PNG frame. */
async function extractSelection(onProgress: ExtractProgress): Promise<ExtractedMedia> {
  const backend = state.backend;
  if (!backend) throw new Error("No video loaded");
  if (state.mode === "frame") {
    onProgress(`Encoding frame ${state.cur}…`);
    return extractFrame({
      backend,
      frameOrder: state.frameOrder,
      frame: state.cur,
      width: state.width,
      height: state.height,
      sourceName: state.sourceName,
    });
  }
  const [lo, hi] = selRange();
  return extractClip({
    sourceFile: state.sourceFile,
    sourceUrl: state.sourceUrl,
    sourceName: state.sourceName,
    lo,
    hi,
    fps: state.fps,
    onProgress,
  });
}

async function runDownload(): Promise<void> {
  if (!state.backend) return;
  setDeliveryBusy(true);
  try {
    const media = await extractSelection((message) => setStatus(els.downloadStatus, message));
    saveBlob(media.blob, media.filename);
    setDeliveryBusy(false);
    setStatus(els.downloadStatus, `Saved ${media.filename} (${bytes(media.blob.size)}).`, "ok");
    log(`Downloaded ${media.filename} (${bytes(media.blob.size)})`, "ok");
  } catch (e) {
    setDeliveryBusy(false);
    setStatus(els.downloadStatus, friendlyError(e), "err");
    log(`Download failed: ${friendlyError(e)}`, "err");
    console.error(e);
  }
}

const PHASE_LABEL: Record<UploadPhase, string> = { checksum: "Checksumming", upload: "Uploading", register: "Registering" };

async function uploadOne(cfg: ArchiveConfig, blob: Blob, path: string, contentType: string, label: string): Promise<void> {
  log(`Uploading ${label} to ${path} (${bytes(blob.size)})…`);
  await uploadAsset(cfg, {
    blob,
    path,
    contentType,
    onPhase: (phase, fraction) => {
      setStatus(els.uploadStatus, `${PHASE_LABEL[phase]} ${label}… ${(fraction * 100).toFixed(0)}%`);
      setUploadProgress(fraction);
    },
  });
  log(`Uploaded ${path}`, "ok");
}

async function runUpload(): Promise<void> {
  if (!state.backend) return;
  setDeliveryBusy(true);
  setUploadProgress(0);
  try {
    const media = await extractSelection((message, fraction) => {
      setStatus(els.uploadStatus, message);
      setUploadProgress(fraction ?? 0);
    });
    // Refresh the token before the first request rather than mid-transfer, where an expiry would
    // strand a half-finished multipart upload.
    await ensureFreshOAuth();
    const cfg = currentConfig();
    if (!cfg.dandisetId) throw new Error("Pick an upload destination first.");
    const directory = uploadDirectory(new Date());
    els.uploadPathPreview.textContent = `${directory}/`;
    const uploaded: string[] = [];
    // The extracted selection goes first: it is the point of the upload, and the original — which
    // can be orders of magnitude larger — is a recommended companion, not a prerequisite for it.
    await uploadOne(cfg, media.blob, uploadAssetPath(directory, media.filename), media.mime, state.mode === "frame" ? "frame" : "snippet");
    uploaded.push(media.filename);
    const original = els.uploadOriginal.checked ? state.sourceFile : null;
    if (original) {
      await uploadOne(cfg, original, uploadAssetPath(directory, original.name), original.type || "video/mp4", "original video");
      uploaded.push(original.name);
    }
    setDeliveryBusy(false);
    setUploadProgress(1, true);
    setStatus(els.uploadStatus, `Uploaded ${uploaded.join(" and ")} to ${directory}/`, "ok");
  } catch (e) {
    setDeliveryBusy(false);
    setUploadProgress(null);
    setStatus(els.uploadStatus, `Upload failed: ${friendlyError(e)}`, "err");
    log(`Upload failed: ${friendlyError(e)}`, "err");
    console.error(e);
  }
}

els.btnDownload.addEventListener("click", () => void runDownload());
els.btnUpload.addEventListener("click", () => void runUpload());

loadAuthSettings();
renderAuthUI();
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
