import { ensureFfmpeg, ffmpegArgs } from "./ffmpeg";
import { decodeIndex, drawVideoFrame } from "./video";
import type { SelectionKind } from "./delivery";
import type { SleapVideoBackend, TrimMode } from "./types";

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
// A sidecar shares every entity with the file it describes and differs only in that suffix, so the
// pair sits side by side in a listing. The original video is not renamed at all — it keeps the name
// it arrived with (see runUpload in main.ts).

/** The source file name minus its extension, for naming derived files. */
export function sourceBaseName(sourceName: string): string {
  return sourceName.replace(/\.[^./]+$/, "") || "clip";
}

/** Reduces a source name to an entity label. Underscores separate entities and hyphens separate a
 * key from its value, so neither can survive inside a value without making the name ambiguous to
 * parse; whitespace becomes `+` so word boundaries stay legible, and everything else
 * non-alphanumeric is dropped. The unabridged original name is preserved in the upload's provenance
 * record, which is what ties the file back to its source. */
export function bidsLabel(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/\s+/g, "+")
      .replace(/[^A-Za-z0-9+]+/g, "")
      .replace(/\+{2,}/g, "+")
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

/** `name-…_<selection>_type-<type>[_<suffix>].<extension>` for one file of an extraction. */
export function assetFileName(entities: AssetEntities, type: string, extension: string, suffix?: string): string {
  const tail = suffix ? `_${suffix}` : "";
  return `${nameEntity(entities.sourceName)}_${selectionEntity(entities)}_type-${type}${tail}.${extension}`;
}

export function clipFileName(sourceName: string, lo: number, hi: number): string {
  return assetFileName({ sourceName, mode: "snippet", inFrame: lo, outFrame: hi }, "snippet", "mp4", "video");
}

export function frameFileName(sourceName: string, frame: number): string {
  return assetFileName({ sourceName, mode: "frame", inFrame: frame, outFrame: frame }, "frame", "png", "image");
}

/** The sidecar shares every entity with the file it describes — including its `type-` — and differs
 * only in its suffix, so the pair sits side by side in a listing. */
export function provenanceFileName(entities: AssetEntities): string {
  return assetFileName(entities, entities.mode, "json", "provenance");
}

export interface ExtractClipParams {
  /** Local bytes, when the video came from the file picker (or a stream that fell back to a full
   * download). Preferred over `sourceUrl`, which has to be fetched in full for ffmpeg. */
  sourceFile: File | null;
  sourceUrl: string | null;
  sourceName: string;
  /** Inclusive selected frame range. */
  lo: number;
  hi: number;
  fps: number;
  /** "precise" (the default) re-encodes for a frame-exact cut; "fast" stream-copies from the
   * nearest keyframe and may include a few extra leading frames. */
  trim?: TrimMode;
  onProgress?: ExtractProgress;
}

/** Trims [lo, hi] out of the source video with ffmpeg.wasm and returns it as an MP4. */
export async function extractClip(params: ExtractClipParams): Promise<ExtractedMedia> {
  const { sourceFile, sourceUrl, sourceName, lo, hi, fps, trim = "precise", onProgress } = params;
  const ext = (/\.[a-z0-9]+$/i.exec(sourceName) ?? [".mp4"])[0];
  const inName = `in${ext}`;
  const outName = "clip.mp4";

  onProgress?.("Loading ffmpeg.wasm…");
  const ff = await ensureFfmpeg({
    onLog: (m) => console.debug("[ffmpeg]", m),
    onProgress: (r) => {
      const done = Math.min(1, Math.max(0, r));
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
  const args = ffmpegArgs(inName, outName, lo, hi, fps, trim);
  const command = `ffmpeg ${args.join(" ")}`;
  console.info(`$ ${command}`);
  onProgress?.("Encoding snippet…", 0);
  try {
    await ff.exec(args);
    const data = await ff.readFile(outName);
    const blob = new Blob([(data as Uint8Array).buffer as ArrayBuffer], { type: "video/mp4" });
    if (!blob.size) throw new Error("ffmpeg produced an empty clip — try a different selection");
    return { blob, filename: clipFileName(sourceName, lo, hi), mime: "video/mp4", encoding: command };
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
}

/** Re-decodes one frame and encodes it as a PNG (no pose overlay burned in). */
export async function extractFrame(params: ExtractFrameParams): Promise<ExtractedMedia> {
  const { backend, frameOrder, frame, width, height, sourceName } = params;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  const decoded = await backend.getFrame(decodeIndex(frameOrder, frame));
  if (!decoded) throw new Error(`Frame ${frame} could not be decoded`);
  drawVideoFrame(decoded, ctx, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The browser could not encode the frame as a PNG");
  return {
    blob,
    filename: frameFileName(sourceName, frame),
    mime: "image/png",
    encoding: "canvas.toBlob(image/png), decoded frame without pose overlay",
  };
}
