import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { TrimMode } from "./types";

// ffmpeg.wasm is loaded lazily (only when an MP4 clip is actually extracted) and its ~30MB core
// is fetched from a CDN rather than bundled, so the app itself stays small. GPL-licensed.
const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegInstance: FFmpeg | null = null;
// The single `log`/`progress` listener registered on the shared instance forwards to whichever
// handlers the most recent ensureFfmpeg() call supplied, since @ffmpeg/ffmpeg's EventEmitter
// requires the original listener reference to unregister one (there's no removeAllListeners).
let currentHandlers: EnsureFfmpegHandlers = {};

/** Builds the ffmpeg CLI args for trimming [lo, hi] (inclusive, frame indices) out of `inName`.
 * "fast" stream-copies at the nearest keyframe (may include a few extra leading frames); "precise"
 * re-encodes with a frame-exact `trim` filter. */
export function ffmpegArgs(inName: string, outName: string, lo: number, hi: number, fps: number, trim: TrimMode): string[] {
  const start = lo / fps;
  const dur = (hi - lo + 1) / fps;
  if (trim === "fast") {
    return ["-ss", start.toFixed(4), "-i", inName, "-t", dur.toFixed(4), "-c", "copy", "-avoid_negative_ts", "make_zero", outName];
  }
  return [
    "-i",
    inName,
    "-vf",
    `trim=start_frame=${lo}:end_frame=${hi + 1},setpts=PTS-STARTPTS`,
    "-an",
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
}

export interface EnsureFfmpegHandlers {
  onLog?: (message: string) => void;
  onProgress?: (progress: number) => void;
}

/** Lazily loads and returns a shared ffmpeg.wasm instance, (re-)wiring log/progress callbacks on
 * every call since a fresh extraction may want fresh handlers. */
export async function ensureFfmpeg(handlers: EnsureFfmpegHandlers = {}): Promise<FFmpeg> {
  currentHandlers = handlers;
  if (!ffmpegInstance) {
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => currentHandlers.onLog?.(message));
    ff.on("progress", ({ progress }) => currentHandlers.onProgress?.(progress));
    ffmpegInstance = ff;
  }
  const ff = ffmpegInstance;
  if (!ff.loaded) {
    await ff.load({
      coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
  }
  return ff;
}
