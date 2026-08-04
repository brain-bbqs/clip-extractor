import "./style.css";
import * as sio from "@talmolab/sleap-io.js";
import { getElements } from "./ui/elements";
import { createLogger } from "./ui/log";
import { renderKv } from "./ui/kv";
import { bytes, fmtTime } from "./lib/format";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "./lib/video";
import { drawPose, labelsToPose } from "./lib/pose";
import { buildAnnotations, countLabeledFramesInRange } from "./lib/annotations";
import { blobToBase64, buildPayload, parseHeaders, targetUrl } from "./lib/payload";
import { ensureFfmpeg, ffmpegArgs } from "./lib/ffmpeg";
import type {
  Extracted,
  ExtractedFrame,
  ImageFormat,
  OutputKind,
  PackagingType,
  PoseModel,
  SleapLabels,
  SleapVideoBackend,
  TrimMode,
} from "./lib/types";

// Pozu backend (pozu-project/pozu-backend PR #28): POST /api/v1/clips accepts a JSON body
// { mp4: <base64>, filename?, author?, timestamp? }, vets the MP4 with ffprobe, and uploads it
// to DANDI synchronously. No auth required.
const POZU_ENDPOINT = "https://pozu-codycbakerphd.pythonanywhere.com/api/v1/clips";
// The backend only allows the pozu-project.github.io origin, so a cross-origin POST from
// vibes.tlab.sh is CORS-blocked; route through the tlab nocors proxy (whitelisted for *.tlab.sh).
const NOCORS_PROXY = "https://nocors.tlab.sh/";

interface PozuResponseBody {
  submission_id?: string;
  clip_file?: string;
  clip_size_bytes?: number;
  message?: string;
}

/** Best-effort JSON parse of a POST response body — returns null for a non-JSON (or malformed)
 * response rather than throwing, since the raw text is still shown either way. */
function parsePozuResponse(text: string): PozuResponseBody | null {
  try {
    return JSON.parse(text) as PozuResponseBody;
  } catch {
    return null;
  }
}

const els = getElements();
const log = createLogger(els.log);
const ctx2d = els.view.getContext("2d");
if (!ctx2d) throw new Error("Canvas 2D context unavailable");
const ctx: CanvasRenderingContext2D = ctx2d;

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
  cur: number;
  inF: number | null;
  outF: number | null;
  playing: boolean;
  speed: number;
  pose: PoseModel | null;
  out: OutputKind;
  trim: TrimMode;
  fmt: ImageFormat;
  pkg: PackagingType;
  extracted: Extracted | null;
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
  out: "clip",
  trim: "precise",
  fmt: "image/png",
  pkg: "pozu",
  extracted: null,
  curBitmap: null,
};

// ============================================================
// Video loading (remote URL + local file / File System Access)
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
    els.origFilename.value = name;
    state.cur = 0;
    state.inF = null;
    state.outF = null;
    invalidateExtraction(true);
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
    updateExtractUI();
  } catch (e) {
    log(`Video error: ${(e as Error).message}`, "err");
    console.error(e);
  }
}

// ============================================================
// SLP loading
// ============================================================
async function loadSlp(source: File | string, name: string): Promise<void> {
  log(`Parsing SLP: ${name}…`);
  try {
    const labels = (await sio.loadSlp(source, { openVideos: false })) as unknown as SleapLabels;
    state.pose = labelsToPose(labels);
    const nFrames = state.pose.byFrame.size;
    log(`SLP loaded: ${state.pose.skeleton.nodes.length} nodes, ${state.pose.tracks.length} tracks, ${nFrames} labeled frames`, "ok");
    els.annBadge.textContent = `${nFrames} frames`;
    els.annBadge.className = "badge on";
    refreshSource();
    renderFrame();
    updateAnnUI();
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
  if (state.pose && els.showPose.checked) drawPose(ctx, state.pose.byFrame.get(state.cur), state.pose.skeleton, state.width);
  els.overlayInfo.textContent = `frame ${state.cur} / ${state.totalFrames - 1}  ·  ${fmtTime(state.cur, state.fps)}`;
}

// ============================================================
// Transport / seeking
// ============================================================
let seeking = false;
let pendingSeek: number | null = null;
// Shift-held seeking extends the selection to cover the frames scrubbed over.
let shiftHeld = false;
let shiftAnchor: number | null = null;

async function seek(frame: number, force = false): Promise<void> {
  frame = Math.max(0, Math.min(state.totalFrames - 1, frame | 0));
  if (shiftHeld) growSelection(frame);
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
  invalidateExtraction();
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
  const n = hi - lo + 1;
  els.rangeSummary.textContent =
    state.inF == null && state.outF == null
      ? `Selection: full video (${state.totalFrames} frames)`
      : `Selection: frames ${lo}–${hi} · ${n} frames · ${(n / state.fps).toFixed(2)}s`;
  updateExtractUI();
}

// ============================================================
// Annotations UI
// ============================================================
function currentClipDescriptor() {
  return {
    sourceName: state.sourceName,
    sourceUrl: state.sourceUrl,
    originalFilename: filenameVal(),
    author: authorVal() || null,
    fps: state.fps,
    width: state.width,
    height: state.height,
  };
}

function updateAnnUI(): void {
  const has = !!state.pose;
  els.annDetails.style.display = has ? "block" : "none";
  if (!has) return;
  const [lo, hi] = selRange();
  const n = countLabeledFramesInRange(state.pose, lo, hi);
  els.annSummary.textContent = `${n} labeled frame(s) fall inside the current selection (${lo}–${hi}). Annotations are re-indexed clip-relative on export.`;
  const ann = buildAnnotations(state.pose, lo, hi, currentClipDescriptor());
  const preview: Record<string, unknown> = { ...ann, frames: ann.frames.slice(0, 2) };
  if (ann.frames.length > 2) (preview.frames as unknown[]).push(`… +${ann.frames.length - 2} more frames`);
  els.annPreview.textContent = JSON.stringify(preview, null, 2);
}

// ============================================================
// Extraction
// ============================================================
function updateFfCmd(): void {
  if (!state.backend) {
    els.ffCmd.textContent = "—";
    return;
  }
  const [lo, hi] = selRange();
  const ext = (/\.[a-z0-9]+$/i.exec(state.sourceName) ?? [".mp4"])[0];
  els.ffCmd.textContent = `ffmpeg ${ffmpegArgs(`in${ext}`, "clip.mp4", lo, hi, state.fps, state.trim).join(" ")}`;
}

async function extractClip(): Promise<void> {
  const [lo, hi] = selRange();
  const ext = (/\.[a-z0-9]+$/i.exec(state.sourceName) ?? [".mp4"])[0];
  const inName = `in${ext}`;
  const outName = "clip.mp4";
  setExProgress(true, "Loading ffmpeg.wasm…");
  try {
    const ff = await ensureFfmpeg({
      onLog: (m) => console.debug("[ffmpeg]", m),
      onProgress: (r) => setExProgress(true, `Encoding… ${(Math.min(1, Math.max(0, r)) * 100).toFixed(0)}%`, r),
    });
    setExProgress(true, "Reading input…");
    let inputBytes: Uint8Array;
    if (state.sourceFile) inputBytes = new Uint8Array(await state.sourceFile.arrayBuffer());
    else if (state.sourceUrl) inputBytes = new Uint8Array(await (await fetch(state.sourceUrl)).arrayBuffer());
    else throw new Error("No source bytes available for ffmpeg");
    await ff.writeFile(inName, inputBytes);
    const args = ffmpegArgs(inName, outName, lo, hi, state.fps, state.trim);
    log(`$ ffmpeg ${args.join(" ")}`);
    setExProgress(true, "Encoding clip…");
    await ff.exec(args);
    const data = await ff.readFile(outName);
    const blob = new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: "video/mp4" });
    try {
      await ff.deleteFile(inName);
      await ff.deleteFile(outName);
    } catch {
      // Best-effort cleanup of ffmpeg's virtual filesystem; a leftover temp file is harmless.
    }
    const base = state.sourceName.replace(/\.[^.]+$/, "");
    state.extracted = { kind: "clip", blob, name: `${base}_clip_${lo}-${hi}.mp4`, mime: "video/mp4" };
    showExResult([
      ["Output", `MP4 clip (${state.trim})`],
      ["Frames", `${lo}–${hi} (${hi - lo + 1})`],
      ["Size", bytes(blob.size)],
    ]);
    log(`Clip extracted: ${bytes(blob.size)}`, "ok");
  } catch (e) {
    log(`Extraction failed: ${(e as Error).message}`, "err");
    console.error(e);
    setExProgress(false, `Failed: ${(e as Error).message}`);
    return;
  }
  setExProgress(false, "");
  updatePayloadButtons();
}

async function extractFrames(): Promise<void> {
  if (!state.backend) return;
  const backend = state.backend;
  const [lo, hi] = selRange();
  const n = hi - lo + 1;
  setExProgress(true, `Decoding ${n} frames…`);
  const tmp = document.createElement("canvas");
  tmp.width = state.width;
  tmp.height = state.height;
  const tctx = tmp.getContext("2d");
  if (!tctx) {
    setExProgress(false, "Failed: canvas unavailable");
    return;
  }
  const q = parseFloat(els.jpgQ.value) || 0.9;
  const frames: ExtractedFrame[] = [];
  const burn = els.burnPose.checked && !!state.pose;
  try {
    for (let i = 0; i < n; i++) {
      const f = lo + i;
      const bmp = await backend.getFrame(decodeIndex(state.frameOrder, f));
      tctx.clearRect(0, 0, tmp.width, tmp.height);
      if (bmp) drawVideoFrame(bmp, tctx, state.width, state.height);
      if (burn && state.pose) drawPose(tctx, state.pose.byFrame.get(f), state.pose.skeleton, state.width);
      const blob = await new Promise<Blob | null>((res) => tmp.toBlob(res, state.fmt, state.fmt === "image/jpeg" ? q : undefined));
      if (blob) frames.push({ source_frame: f, clip_frame: i, blob });
      setExProgress(true, `Decoding frame ${i + 1}/${n}…`, (i + 1) / n);
    }
  } catch (e) {
    log(`Frame extraction failed: ${(e as Error).message}`, "err");
    setExProgress(false, `Failed: ${(e as Error).message}`);
    return;
  }
  const ext = state.fmt === "image/jpeg" ? "jpg" : "png";
  const total = frames.reduce((s, f) => s + f.blob.size, 0);
  state.extracted = { kind: "frames", frames, ext, mime: state.fmt, name: `${state.sourceName.replace(/\.[^.]+$/, "")}_frames` };
  showExResult([
    ["Output", `${frames.length} × ${ext.toUpperCase()}`],
    ["Frames", `${lo}–${hi}`],
    ["Total size", bytes(total)],
  ]);
  log(`Extracted ${frames.length} frames (${bytes(total)})`, "ok");
  setExProgress(false, "");
  updatePayloadButtons();
}

function setExProgress(on: boolean, note: string, ratio?: number): void {
  els.exProg.style.display = on ? "block" : "none";
  if (ratio != null) {
    const fill = els.exProg.querySelector<HTMLDivElement>(".fill");
    if (fill) fill.style.width = `${(ratio * 100).toFixed(0)}%`;
  }
  els.exNote.textContent = note;
  els.btnExtract.disabled = on || !state.backend;
}

function showExResult(rows: [string, string | number][]): void {
  els.exResult.style.display = "grid";
  renderKv(els.exResult, rows);
}

// ============================================================
// Payload assembly + transmit
// ============================================================
function authorVal(): string {
  return els.author.value.trim();
}
function filenameVal(): string | null {
  return els.origFilename.value.trim() || state.sourceName || null;
}

function metadataObj() {
  const [lo, hi] = selRange();
  const ex = state.extracted;
  return {
    source: state.sourceName,
    source_url: state.sourceUrl,
    original_filename: filenameVal(),
    author: authorVal() || null,
    in_frame: lo,
    out_frame: hi,
    num_frames: hi - lo + 1,
    fps: state.fps,
    width: state.width,
    height: state.height,
    media_kind: ex ? ex.kind : null,
    media_mime: ex ? ex.mime : null,
    frame_count: ex && ex.kind === "frames" ? ex.frames.length : ex ? 1 : 0,
    has_annotations: !!state.pose,
    created_at: new Date().toISOString(),
  };
}

function currentAnnotations() {
  const [lo, hi] = selRange();
  return buildAnnotations(state.pose, lo, hi, currentClipDescriptor());
}

function parseExtraHeaders(): Record<string, string> {
  return parseHeaders(els.headers.value);
}

function currentTargetUrl(): string | null {
  return targetUrl(els.endpoint.value, els.useProxy.checked, NOCORS_PROXY);
}

async function previewRequest(): Promise<void> {
  if (!state.extracted) {
    els.txNote.textContent = "Preview error: Nothing extracted yet";
    return;
  }
  try {
    const extracted = state.extracted;
    const p = await buildPayload({
      extracted,
      pkg: state.pkg,
      meta: metadataObj(),
      annotations: currentAnnotations(),
      filename: filenameVal() ?? "",
      author: authorVal(),
    });
    const url = currentTargetUrl() ?? "(dry-run — no endpoint set)";
    const headers = parseExtraHeaders();
    const lines = [`POST ${url}`, ""];
    Object.entries(headers).forEach(([k, v]) => lines.push(`${k}: ${v}`));
    if (p.type === "pozu") {
      lines.push("Content-Type: application/json", `Body size: ${bytes(new Blob([p.body]).size)}`, "");
      lines.push(
        JSON.stringify(
          { ...p.obj, mp4: `…(${p.obj.mp4.length} base64 chars = ${bytes(extracted.kind === "clip" ? extracted.blob.size : 0)} MP4)…` },
          null,
          2,
        ),
      );
      lines.push("", "Note: /clips takes the MP4 only — annotations are not sent (use Download for annotations.json).");
    } else if (p.type === "multipart") {
      lines.push("Content-Type: multipart/form-data (boundary set by browser)", "", "Parts:");
      for (const [k, v] of p.body.entries()) {
        const size = v instanceof Blob ? ` (${bytes(v.size)}, ${v.type || "binary"})` : "";
        const nm = v instanceof File ? ` "${v.name}"` : "";
        lines.push(`  • ${k}${nm}${size}`);
      }
      const framesPreview: unknown[] = p.ann.frames.slice(0, 1);
      if (p.ann.frames.length > 1) framesPreview.push("…");
      lines.push("", "— annotations.json —", JSON.stringify({ ...p.ann, frames: framesPreview }, null, 2));
    } else {
      lines.push("Content-Type: application/json", `Body size: ${bytes(new Blob([p.body]).size)}`, "");
      const media =
        p.obj.media.kind === "clip"
          ? {
              kind: "clip",
              mime: p.obj.media.mime,
              filename: p.obj.media.filename,
              data_base64: `…(${p.obj.media.data_base64.length} chars)…`,
            }
          : { kind: "frames", ext: p.obj.media.ext, frames: `…(${p.obj.media.frames.length} base64 images)…` };
      const shape = { metadata: p.obj.metadata, annotations: `…(${p.ann.frames.length} frames)…`, media };
      lines.push(JSON.stringify(shape, null, 2));
    }
    els.txPreview.style.display = "block";
    els.txPreview.textContent = lines.join("\n");
    els.txNote.textContent = "Dry-run preview — nothing sent.";
  } catch (e) {
    els.txNote.textContent = `Preview error: ${(e as Error).message}`;
  }
}

async function sendRequest(): Promise<void> {
  if (!els.endpoint.value.trim()) {
    els.txNote.textContent = "Set an endpoint URL to send (or use Preview / Download).";
    return;
  }
  if (!state.extracted) {
    els.txNote.textContent = "Nothing extracted yet.";
    return;
  }
  els.btnSend.disabled = true;
  els.txNote.textContent = "Building payload…";
  try {
    const p = await buildPayload({
      extracted: state.extracted,
      pkg: state.pkg,
      meta: metadataObj(),
      annotations: currentAnnotations(),
      filename: filenameVal() ?? "",
      author: authorVal(),
    });
    const url = currentTargetUrl();
    if (!url) throw new Error("No endpoint set");
    const headers = parseExtraHeaders();
    if (p.contentType) headers["Content-Type"] = p.contentType;
    els.txNote.textContent = "Sending…";
    const resp = await fetch(url, { method: "POST", headers, body: p.body });
    const text = await resp.text();
    const parsed = parsePozuResponse(text);
    els.txPreview.style.display = "block";
    els.txPreview.textContent = `HTTP ${resp.status} ${resp.statusText}\n\n${text.slice(0, 2000)}`;
    if (resp.ok && p.type === "pozu" && parsed?.submission_id) {
      els.txNote.textContent = `✓ Uploaded — submission ${parsed.submission_id}, ${parsed.clip_file} (${bytes(parsed.clip_size_bytes)})`;
    } else if (resp.ok) {
      els.txNote.textContent = "✓ Sent.";
    } else {
      const msg = parsed?.message ?? `HTTP ${resp.status}`;
      const hint =
        resp.status === 502
          ? " (DANDI upload failed — the clip is still here; retry.)"
          : resp.status === 413
            ? " (payload too large.)"
            : "";
      els.txNote.textContent = `⚠ ${msg}${hint}`;
    }
    log(`POST → ${resp.status}`, resp.ok ? "ok" : "warn");
  } catch (e) {
    const proxied = els.useProxy.checked;
    const msg = (e as Error).message;
    els.txNote.textContent = `Send failed: ${msg}${proxied ? " (proxy only serves *.tlab.sh origins; on the deployed vibe this works.)" : " (CORS — enable the nocors proxy, or the backend must allow this origin.)"}`;
    log(`POST failed: ${msg}`, "err");
    console.error(e);
  } finally {
    els.btnSend.disabled = false;
  }
}

function dl(blob: Blob, name: string): void {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

async function downloadPayload(): Promise<void> {
  const ex = state.extracted;
  if (!ex) return;
  dl(new Blob([JSON.stringify(currentAnnotations(), null, 2)], { type: "application/json" }), "annotations.json");
  dl(new Blob([JSON.stringify(metadataObj(), null, 2)], { type: "application/json" }), "metadata.json");
  if (ex.kind === "clip") {
    dl(ex.blob, ex.name);
  } else {
    // Bundle frames as a single base64 JSON to avoid dozens of downloads.
    const frames = await Promise.all(
      ex.frames.map(async (f) => ({
        source_frame: f.source_frame,
        clip_frame: f.clip_frame,
        mime: ex.mime,
        data_base64: await blobToBase64(f.blob),
      })),
    );
    dl(new Blob([JSON.stringify({ ext: ex.ext, mime: ex.mime, frames }, null, 2)], { type: "application/json" }), `${ex.name}.json`);
  }
  els.txNote.textContent = "Payload files downloaded.";
}

function updatePayloadButtons(): void {
  const has = !!state.extracted;
  els.btnPreview.disabled = !has;
  els.btnSend.disabled = !has;
  els.btnDownload.disabled = !has;
}

function updatePkgNote(): void {
  if (state.pkg === "pozu") {
    els.pkgNote.textContent =
      state.out === "clip"
        ? "Pozu /clips: POSTs { mp4 (base64), filename, author, timestamp } as JSON; the backend validates the MP4 with ffprobe and uploads it to DANDI. Annotations are not sent — download them separately."
        : '⚠ Pozu /clips accepts a single MP4 clip only — set the Extract output to "MP4 clip".';
  } else if (state.pkg === "multipart") {
    els.pkgNote.textContent = "Generic multipart/form-data: media + annotations.json + metadata.json parts.";
  } else {
    els.pkgNote.textContent = "Generic application/json with base64 media + annotations + metadata.";
  }
  els.txBadge.textContent = state.pkg === "pozu" ? "Pozu /clips" : "generic";
  els.txBadge.className = state.pkg === "pozu" ? "badge on" : "badge";
}

// Any change to the selection range or source invalidates a prior extraction, so the payload
// (built live from the current selection) can never disagree with the media bytes.
function invalidateExtraction(silent = false): void {
  if (state.extracted) {
    state.extracted = null;
    els.exResult.style.display = "none";
    els.txPreview.style.display = "none";
    if (!silent) log("Selection changed — re-extract before building the payload.", "warn");
  }
  updatePayloadButtons();
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

function updateExtractUI(): void {
  els.btnExtract.disabled = !state.backend;
  updateFfCmd();
  updateAnnUI();
}

function refreshSource(): void {
  if (!state.backend) {
    els.srcInfo.style.display = "none";
    return;
  }
  els.srcInfo.style.display = "grid";
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
      segEl.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const value = Object.values(b.dataset)[0];
      if (value != null) apply(value);
    });
  });
}

wireSeg(els.outSeg, (v) => {
  state.out = v as OutputKind;
  const clip = state.out === "clip";
  els.clipOpts.style.display = clip ? "block" : "none";
  els.framesOpts.style.display = clip ? "none" : "block";
  els.btnExtract.textContent = clip ? "Extract clip" : "Extract frames";
  updatePkgNote();
});
wireSeg(els.trimSeg, (v) => {
  state.trim = v as TrimMode;
  updateFfCmd();
});
wireSeg(els.fmtSeg, (v) => {
  state.fmt = v as ImageFormat;
  els.jpgQWrap.style.display = state.fmt === "image/jpeg" ? "inline" : "none";
});
wireSeg(els.pkgSeg, (v) => {
  state.pkg = v as PackagingType;
  updatePkgNote();
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
  invalidateExtraction();
  updateSelUI();
});
els.btnSetOut.addEventListener("click", () => {
  state.outF = state.cur;
  if (state.inF != null && state.inF > state.outF) state.inF = null;
  invalidateExtraction();
  updateSelUI();
});
els.btnClearSel.addEventListener("click", () => {
  state.inF = null;
  state.outF = null;
  invalidateExtraction();
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
  } else if (e.key === "i" || e.key === "I" || e.key === "[") {
    els.btnSetIn.click();
  } else if (e.key === "o" || e.key === "O" || e.key === "]") {
    els.btnSetOut.click();
  }
});

// Source loaders
els.loadVideoUrl.addEventListener("click", () => {
  const url = els.videoUrl.value.trim();
  if (url) {
    state.sourceFile = null;
    void loadVideo(url, url.split("/").pop()?.split("?")[0] || "video.mp4", url);
  }
});
els.loadSlpUrl.addEventListener("click", () => {
  const url = els.slpUrl.value.trim();
  if (url) void loadSlp(url, url.split("/").pop() || "labels.slp");
});
els.pickVideo.addEventListener("click", () => void pickFile(["video/*"], (f) => void loadVideo(f, f.name)));
els.pickSlp.addEventListener("click", () => void pickFile([".slp", ".h5", ".hdf5"], (f) => void loadSlp(f, f.name)));
els.videoFile.addEventListener("change", () => {
  const f = els.videoFile.files?.[0];
  if (f) void loadVideo(f, f.name);
});
els.slpFile.addEventListener("change", () => {
  const f = els.slpFile.files?.[0];
  if (f) void loadSlp(f, f.name);
});

async function pickFile(accept: string[], cb: (f: File) => void): Promise<void> {
  if ("showOpenFilePicker" in window) {
    try {
      const showOpenFilePicker = (
        window as unknown as { showOpenFilePicker: (opts: { multiple: boolean }) => Promise<{ getFile(): Promise<File> }[]> }
      ).showOpenFilePicker;
      const [h] = await showOpenFilePicker({ multiple: false });
      const f = await h.getFile();
      cb(f);
    } catch (e) {
      if ((e as Error).name !== "AbortError") log(`File pick failed: ${(e as Error).message}`, "warn");
    }
  } else {
    const inp = accept.some((a) => a.startsWith(".slp") || a.includes("h5")) ? els.slpFile : els.videoFile;
    inp.click();
  }
}

// Drag & drop (video and/or slp)
["dragover", "dragenter"].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.add("over");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.remove("over");
  }),
);
els.drop.addEventListener("drop", (e) => {
  for (const f of e.dataTransfer?.files ?? []) {
    if (/\.(slp|h5|hdf5)$/i.test(f.name)) void loadSlp(f, f.name);
    else void loadVideo(f, f.name);
  }
});

// Sample
async function loadSample(): Promise<void> {
  const base = new URL("..", location.href).href; // repo root
  log("Loading sample from slp-viewer/…");
  await loadVideo(`${base}slp-viewer/mice.mp4`, "mice.mp4", `${base}slp-viewer/mice.mp4`);
  await loadSlp(`${base}slp-viewer/mice.tracked.slp`, "mice.tracked.slp");
}
els.sampleBtn.addEventListener("click", () => void loadSample());
els.sampleBtn2.addEventListener("click", () => void loadSample());

// Extract / transmit
els.btnExtract.addEventListener("click", () => void (state.out === "clip" ? extractClip() : extractFrames()));
els.btnPreview.addEventListener("click", () => void previewRequest());
els.btnSend.addEventListener("click", () => void sendRequest());
els.btnDownload.addEventListener("click", () => void downloadPayload());
els.dlAnn.addEventListener("click", () =>
  dl(new Blob([JSON.stringify(currentAnnotations(), null, 2)], { type: "application/json" }), "annotations.json"),
);

// Transmit defaults: prefill the Pozu endpoint and remember the author locally.
const AUTHOR_STORAGE_KEY = "clipex_author";
els.endpoint.value = POZU_ENDPOINT;
els.author.value = localStorage.getItem(AUTHOR_STORAGE_KEY) ?? "";
els.author.addEventListener("input", () => localStorage.setItem(AUTHOR_STORAGE_KEY, els.author.value));
updatePkgNote();

// URL params: ?url=<video>&slp=<slp>&endpoint=<url>
function initFromUrlParams(): void {
  const p = new URLSearchParams(location.search);
  const endpoint = p.get("endpoint");
  if (endpoint) els.endpoint.value = endpoint;
  const url = p.get("url");
  if (url) {
    els.videoUrl.value = url;
    void loadVideo(url, url.split("/").pop() || "video.mp4", url);
  }
  const slp = p.get("slp");
  if (slp) {
    els.slpUrl.value = slp;
    setTimeout(() => void loadSlp(slp, slp.split("/").pop() || "labels.slp"), 600);
  }
}
initFromUrlParams();

log("Ready. Load a video (URL or file) to begin.");
