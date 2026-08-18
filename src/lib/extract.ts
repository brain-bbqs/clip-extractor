import { VideoSample } from "mediabunny";
import { encodedFraction, ensureFfmpeg, ffmpegArgs, streamCopies } from "./ffmpeg";
import { decodeIndex, drawVideoFrame } from "./video";
import { drawPose } from "./pose";
import { blurSummary, paintBlurRegions, type BlurRegion } from "./blur";
import type { StreamingVideoBackend } from "./streaming";
import type { SelectionKind } from "./delivery";
import type { PoseModel, SleapVideoBackend, TrimMode } from "./types";

// Turns the current selection into a single file, ready for either delivery route (download or
// upload). Snippets go through ffmpeg.wasm; a single frame is re-decoded onto an offscreen canvas
// so the saved image carries no player overlay.

export interface ExtractedMedia {
  blob: Blob;
  filename: string;
  mime: string;
  /** How this file was produced, recorded in the upload's provenance sidecar: the literal ffmpeg
   * command for a snippet, or the encoder used for a frame. */
  encoding: string;
}

/** Reports what extraction is doing, plus 0..1 progress when the step can measure it. */
export type ExtractProgress = (message: string, fraction?: number) => void;

// Every file this app produces is named in BIDS entity style — `key-value` pairs joined by
// underscores, then a suffix naming what the file holds:
//   name-<source>_index-<frame>_type-frame_image.png
//   name-<source>_index-<frame>_type-frame_provenance.json
//   name-<source>_range-<in>+<out>_type-snippet_video.mp4
//   name-<source>_range-<in>+<out>_type-snippet_provenance.json
//   name-<source>_range-<in>+<out>_type-snippet_overlay.mp4
//   name-<source>_range-<in>+<out>_type-snippet_bundle.tar.gz
// Files describing or rendering the same selection share every entity with it and differ only in
// that suffix, so they sit side by side in a listing. The original video is not renamed at all — it
// keeps the name it arrived with (see runUpload in main.ts).

/** The source file name minus its extension, for naming derived files. */
export function sourceBaseName(sourceName: string): string {
  return sourceName.replace(/\.[^./]+$/, "") || "clip";
}

/** Reduces a source name to an entity label. Underscores separate entities and hyphens separate a
 * key from its value, so neither can survive inside a value without making the name ambiguous to
 * parse — but they are word separators in a file name, so they become `+` along with spaces and any
 * other punctuation, rather than closing the gap. Accents fold into their base letter instead of
 * reading as a separator. The unabridged original name is preserved in the upload's provenance
 * record, which is what ties the file back to its source. */
export function bidsLabel(value: string): string {
  return (
    value
      .normalize("NFKD")
      // Drop combining marks first, so "café" folds to "cafe" rather than splitting at the accent.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "+")
      .replace(/^\++|\++$/g, "") || "clip"
  );
}

/** The entities identifying one extraction, shared by every file it produces. */
export interface AssetEntities {
  sourceName: string;
  mode: SelectionKind;
  /** Inclusive source-frame bounds; equal to each other in frame mode. */
  inFrame: number;
  outFrame: number;
}

function nameEntity(sourceName: string): string {
  return `name-${bidsLabel(sourceBaseName(sourceName))}`;
}

function selectionEntity(entities: AssetEntities): string {
  return entities.mode === "frame" ? `index-${entities.inFrame}` : `range-${entities.inFrame}+${entities.outFrame}`;
}

/** One file of an extraction: `name-…_<selection>_type-<type>[_<suffix>].<extension>`. */
export interface AssetNameParts {
  type: string;
  /** Names what the file holds: `video`, `image`, `overlay`, `provenance`. */
  suffix?: string;
  extension: string;
}

export function assetFileName(entities: AssetEntities, parts: AssetNameParts): string {
  const suffix = parts.suffix ? `_${parts.suffix}` : "";
  return `${nameEntity(entities.sourceName)}_${selectionEntity(entities)}_type-${parts.type}${suffix}.${parts.extension}`;
}

export function clipFileName(sourceName: string, lo: number, hi: number): string {
  return assetFileName({ sourceName, mode: "snippet", inFrame: lo, outFrame: hi }, { type: "snippet", suffix: "video", extension: "mp4" });
}

export function frameFileName(sourceName: string, frame: number): string {
  return assetFileName(
    { sourceName, mode: "frame", inFrame: frame, outFrame: frame },
    { type: "frame", suffix: "image", extension: "png" },
  );
}

/** The sidecar shares every entity with the file it describes — including its `type-` — and differs
 * only in its suffix, so the pair sits side by side in a listing. */
export function provenanceFileName(entities: AssetEntities): string {
  return assetFileName(entities, { type: entities.mode, suffix: "provenance", extension: "json" });
}

/** The saved bundle: every file an upload would have written, tarred and gzipped into one download.
 * It shares its selection's entities like the rest, and `bundle` names what it holds. */
export function bundleFileName(entities: AssetEntities): string {
  return assetFileName(entities, { type: entities.mode, suffix: "bundle", extension: "tar.gz" });
}

/** The same selection with the pose drawn into the pixels, so `overlay` in place of the plain
 * extract's `image`/`video` suffix. */
export function overlayFileName(entities: AssetEntities): string {
  return assetFileName(entities, {
    type: entities.mode,
    suffix: "overlay",
    extension: entities.mode === "frame" ? "png" : "mp4",
  });
}

export interface ExtractClipParams {
  /** Local bytes, when the video came from the file picker (or a stream that fell back to a full
   * download). Preferred over `sourceUrl`, which has to be fetched in full for ffmpeg. */
  sourceFile: File | null;
  sourceUrl: string | null;
  /** The open video, when it is one being streamed. With no local bytes this is what the selection
   * is cut out of, over the same range requests that play it. */
  backend?: StreamingVideoBackend | null;
  sourceName: string;
  /** Inclusive selected frame range. */
  lo: number;
  hi: number;
  fps: number;
  /** "precise" (the default) re-encodes for a frame-exact cut; "fast" stream-copies from the
   * nearest keyframe and may include a few extra leading frames. */
  trim?: TrimMode;
  /** Areas blurred into every frame on the way out, in source pixels. */
  blur?: BlurRegion[];
  /** How `sourceFile` came to be, when it is not the file that was opened but a conversion of it
   * (see openLocalSource in main.ts). Recorded ahead of the trim in the clip's `encoding`, so the
   * provenance names every command the frames passed through rather than only the last one. */
  sourcePreparation?: string | null;
  onProgress?: ExtractProgress;
}

/** Draws each frame onto a canvas, paints the blur into it, and hands it back to the muxer. */
function blurProcessor(width: number, height: number, blur: BlurRegion[]): (sample: VideoSample) => VideoSample {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return (sample) => {
    ctx.clearRect(0, 0, width, height);
    sample.draw(ctx, 0, 0);
    paintBlurRegions(ctx, blur, width, height);
    // A fresh sample per frame rather than the canvas itself: the canvas is reused, and handing it
    // over would let the next frame paint over one the encoder had not read yet.
    return new VideoSample(canvas, { timestamp: sample.timestamp, duration: sample.duration });
  };
}

/** Trims [lo, hi] straight out of a streamed source, reading only the bytes that range needs. */
async function extractStreamedClip(params: ExtractClipParams & { backend: StreamingVideoBackend }): Promise<ExtractedMedia> {
  const { backend, sourceName, lo, hi, trim = "precise", blur = [], onProgress } = params;
  onProgress?.("Trimming the selection out of the stream…", 0);
  const { blob, transcoded, start, end } = await backend.extractRange(lo, hi, {
    precise: trim === "precise",
    process: blur.length ? blurProcessor(backend.width, backend.height, blur) : undefined,
    onProgress: (fraction) => onProgress?.(`Trimming the selection… ${(fraction * 100).toFixed(0)}%`, fraction),
  });
  onProgress?.("Trimming the selection… 100%", 1);
  const blurred = blurSummary(blur);
  const how = transcoded ? "frames re-encoded" : "frames copied over untouched";
  return {
    blob,
    filename: clipFileName(sourceName, lo, hi),
    mime: "video/mp4",
    encoding: `mediabunny trim ${start.toFixed(3)}s–${end.toFixed(3)}s out of the streamed source, ${how}, audio dropped${
      blurred ? `, ${blurred}` : ""
    }`,
  };
}

/** Trims [lo, hi] out of the source video and returns it as an MP4: straight out of the stream when
 * that is what is open, and through ffmpeg.wasm when the bytes are already in the browser. */
export async function extractClip(params: ExtractClipParams): Promise<ExtractedMedia> {
  const { sourceFile, sourceUrl, backend, sourceName, lo, hi, fps, trim = "precise", blur = [], sourcePreparation, onProgress } = params;
  // Checked before ffmpeg is even loaded: it works out of a virtual filesystem, so it would need
  // the whole container written into memory first, which for a streamed recording means downloading
  // all of it however few frames were selected.
  if (!sourceFile && backend) return extractStreamedClip({ ...params, backend });
  const ext = (/\.[a-z0-9]+$/i.exec(sourceName) ?? [".mp4"])[0];
  const inName = `in${ext}`;
  const outName = "clip.mp4";

  const clipSeconds = (hi - lo + 1) / fps;

  onProgress?.("Loading ffmpeg.wasm…");
  const ff = await ensureFfmpeg({
    onLog: (m) => console.debug("[ffmpeg]", m),
    onProgress: (event) => {
      const done = encodedFraction(event, clipSeconds);
      if (done === null) return;
      onProgress?.(`Encoding snippet… ${(done * 100).toFixed(0)}%`, done);
    },
  });

  let inputBytes: Uint8Array;
  if (sourceFile) {
    onProgress?.("Reading the source video…");
    inputBytes = new Uint8Array(await sourceFile.arrayBuffer());
  } else if (sourceUrl) {
    // ffmpeg needs the whole container, so a streamed source has to be fetched in full here even
    // though playback never downloaded it.
    onProgress?.("Downloading the source video…");
    const resp = await fetch(sourceUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching the source video`);
    inputBytes = new Uint8Array(await resp.arrayBuffer());
  } else {
    throw new Error("No source bytes available for ffmpeg");
  }

  await ff.writeFile(inName, inputBytes);
  const args = ffmpegArgs(inName, outName, lo, hi, fps, trim, blur);
  const command = `ffmpeg ${args.join(" ")}`;
  console.info(`$ ${command}`);
  // A re-encode runs the frames through a filter, so ffmpeg decodes the source from its start up to
  // the selection before a single frame of the snippet exists, and it has nothing to report for as
  // long as that takes. Naming the step beats leaving a bar at 0% through it.
  const readsUpToSelection = !streamCopies(trim, blur) && lo > 0;
  onProgress?.(readsUpToSelection ? `Decoding the source up to frame ${lo}…` : "Encoding snippet…", 0);
  try {
    await ff.exec(args);
    // ffmpeg's last report lands on the final frame's timestamp, which is a frame short of the whole
    // duration. The encode is over once exec returns, so say so rather than stopping just under it.
    onProgress?.("Encoding snippet… 100%", 1);
    const data = await ff.readFile(outName);
    const blob = new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: "video/mp4" });
    if (!blob.size) throw new Error("ffmpeg produced an empty clip — try a different selection");
    const encoding = sourcePreparation ? `${sourcePreparation}, then ${command}` : command;
    return { blob, filename: clipFileName(sourceName, lo, hi), mime: "video/mp4", encoding };
  } finally {
    try {
      await ff.deleteFile(inName);
      await ff.deleteFile(outName);
    } catch {
      // Best-effort cleanup of ffmpeg's virtual filesystem; a leftover temp file is harmless.
    }
  }
}

export interface ExtractFrameParams {
  backend: SleapVideoBackend;
  frameOrder: number[] | null;
  frame: number;
  width: number;
  height: number;
  sourceName: string;
  /** Areas blurred into the image, in source pixels. */
  blur?: BlurRegion[];
}

/** Re-decodes one frame and encodes it as a PNG (no pose overlay burned in). */
export async function extractFrame(params: ExtractFrameParams): Promise<ExtractedMedia> {
  const { backend, frameOrder, frame, width, height, sourceName, blur = [] } = params;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const decoded = await backend.getFrame(decodeIndex(frameOrder, frame));
  if (!decoded) throw new Error(`Frame ${frame} could not be decoded`);
  drawVideoFrame(decoded, ctx, width, height);
  paintBlurRegions(ctx, blur, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The browser could not encode the frame as a PNG");
  const blurred = blurSummary(blur);
  return {
    blob,
    filename: frameFileName(sourceName, frame),
    mime: "image/png",
    encoding: `canvas.toBlob(image/png), decoded frame without pose overlay${blurred ? `, ${blurred}` : ""}`,
  };
}

export interface ExtractOverlayParams {
  backend: SleapVideoBackend;
  frameOrder: number[] | null;
  pose: PoseModel;
  mode: SelectionKind;
  /** Inclusive source-frame bounds; equal to each other in frame mode. */
  inFrame: number;
  outFrame: number;
  fps: number;
  width: number;
  height: number;
  sourceName: string;
  /** Areas blurred into every frame, in source pixels. */
  blur?: BlurRegion[];
  onProgress?: ExtractProgress;
}

/**
 * Renders the same selection with the pose drawn into the pixels, for looking at without needing a
 * viewer that understands `.slp`. A frame comes out as a PNG; a snippet is drawn frame by frame and
 * encoded by the same ffmpeg.wasm that trims the plain snippet, so both are frame-exact H.264 and
 * neither depends on which codecs the browser itself can encode.
 */
export async function extractOverlay(params: ExtractOverlayParams): Promise<ExtractedMedia> {
  const { backend, frameOrder, pose, mode, inFrame, outFrame, fps, width, height, sourceName, blur = [], onProgress } = params;
  const entities: AssetEntities = { sourceName, mode, inFrame, outFrame };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  async function renderOverlayFrame(frame: number): Promise<Blob> {
    const decoded = await backend.getFrame(decodeIndex(frameOrder, frame));
    if (!decoded) throw new Error(`Frame ${frame} could not be decoded`);
    ctx!.clearRect(0, 0, width, height);
    drawVideoFrame(decoded, ctx!, width, height);
    // Before the pose, so the skeleton stays legible on top of the blur rather than being smeared
    // by it — and so no blurred area is left readable under a gap in the drawing.
    paintBlurRegions(ctx!, blur, width, height);
    drawPose(ctx!, pose.byFrame.get(frame), pose.skeleton, width);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not encode the overlay frame as a PNG");
    return blob;
  }

  const blurred = blurSummary(blur);
  if (mode === "frame") {
    onProgress?.(`Drawing the overlay on frame ${inFrame}…`);
    return {
      blob: await renderOverlayFrame(inFrame),
      filename: overlayFileName(entities),
      mime: "image/png",
      encoding: `canvas.toBlob(image/png), decoded frame with the pose overlay drawn in${blurred ? `, ${blurred}` : ""}`,
    };
  }

  const total = outFrame - inFrame + 1;
  const outName = "overlay.mp4";
  const written: string[] = [];
  onProgress?.("Loading ffmpeg.wasm…");
  const ff = await ensureFfmpeg({
    onLog: (m) => console.debug("[ffmpeg]", m),
    onProgress: (event) => {
      const done = encodedFraction(event, total / fps);
      if (done === null) return;
      onProgress?.(`Encoding the overlay snippet… ${(done * 100).toFixed(0)}%`, done);
    },
  });
  try {
    for (let i = 0; i < total; i++) {
      const png = await renderOverlayFrame(inFrame + i);
      const name = `ov${String(i).padStart(6, "0")}.png`;
      await ff.writeFile(name, new Uint8Array(await png.arrayBuffer()));
      written.push(name);
      onProgress?.(`Drawing the overlay… frame ${i + 1}/${total}`, (i + 1) / total);
    }
    // A PNG sequence rather than a filter over the source: the overlay only exists on these canvases,
    // and image2 input keeps the cut frame-exact without re-deriving the range.
    const args = [
      "-framerate",
      fps.toFixed(4),
      "-start_number",
      "0",
      "-i",
      "ov%06d.png",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outName,
    ];
    const command = `ffmpeg ${args.join(" ")}`;
    console.info(`$ ${command}`);
    onProgress?.("Encoding the overlay snippet…", 0);
    await ff.exec(args);
    onProgress?.("Encoding the overlay snippet… 100%", 1);
    const data = await ff.readFile(outName);
    const blob = new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: "video/mp4" });
    if (!blob.size) throw new Error("ffmpeg produced an empty overlay clip");
    // The blur is in the PNG sequence rather than in this command, so it is named alongside it: the
    // encoding line is what the provenance record quotes as how the file was produced.
    return {
      blob,
      filename: overlayFileName(entities),
      mime: "video/mp4",
      encoding: blurred ? `${command} (frames drawn with ${blurred})` : command,
    };
  } finally {
    for (const name of [...written, outName]) {
      try {
        await ff.deleteFile(name);
      } catch {
        // Best-effort cleanup of ffmpeg's virtual filesystem; a leftover temp file is harmless.
      }
    }
  }
}
