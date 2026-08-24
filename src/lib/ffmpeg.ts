import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { blurFilterChain, type BlurRegion } from "./blur";
import type { PixelFormatInfo } from "./videoFormat";
import type { TrimMode } from "./types";

// ffmpeg.wasm is loaded lazily (only when an MP4 clip is actually extracted) and its ~30MB core
// is fetched from a CDN rather than bundled, so the app itself stays small. GPL-licensed.
const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegInstance: FFmpeg | null = null;
// The single `log`/`progress` listener registered on the shared instance forwards to whichever
// handlers the most recent ensureFfmpeg() call supplied, since @ffmpeg/ffmpeg's EventEmitter
// requires the original listener reference to unregister one (there's no removeAllListeners).
let currentHandlers: EnsureFfmpegHandlers = {};

/** The pixel layout every re-encode here is told to write, named as the sidecar names it (BEP047's
 * `ImagePixelFormat`/`ImageBitDepth`). Exported because that instruction is the last word on what
 * lands: ffmpeg either writes these pixels or fails, where reading them back off the finished file
 * depends on this browser being able to decode H.264 at all (see lib/videoFormat.ts). */
export const ENCODED_PIXEL_FORMAT: PixelFormatInfo = { pixelFormat: "yuv420p", bitDepth: 8 };

// Shared by every re-encoding path here: H.264 in a faststart MP4, no audio.
const ENCODE_ARGS = [
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "23",
  "-pix_fmt",
  ENCODED_PIXEL_FORMAT.pixelFormat,
  "-movflags",
  "+faststart",
];

// Nothing this app writes carries audio. A recording it exists to de-identify should not send
// voices to the archive in a track nobody was shown, and the player never offered one to review.
// The re-encoding paths get this through ENCODE_ARGS; a stream copy has to be told separately,
// since `-c copy` would otherwise carry every stream in the source straight through.
const NO_AUDIO = "-an";

/** Builds the ffmpeg CLI args for trimming [lo, hi] (inclusive, frame indices) out of `inName`,
 * blurring `blur`'s regions into every frame on the way through. "fast" stream-copies at the nearest
 * keyframe (may include a few extra leading frames); "precise" re-encodes with a frame-exact `trim`
 * filter. Any blur region forces a re-encode whatever the trim mode says: a stream copy hands the
 * source's own frames over untouched, which is the one thing a blur must not do. */
export function ffmpegArgs(
  inName: string,
  outName: string,
  lo: number,
  hi: number,
  fps: number,
  trim: TrimMode,
  blur: BlurRegion[] = [],
): string[] {
  const start = lo / fps;
  const dur = (hi - lo + 1) / fps;
  if (streamCopies(trim, blur)) {
    return [
      "-ss",
      start.toFixed(4),
      "-i",
      inName,
      "-t",
      dur.toFixed(4),
      "-c",
      "copy",
      NO_AUDIO,
      "-avoid_negative_ts",
      "make_zero",
      outName,
    ];
  }
  const trimChain = `trim=start_frame=${lo}:end_frame=${hi + 1},setpts=PTS-STARTPTS`;
  if (!blur.length) return ["-i", inName, "-vf", trimChain, ...ENCODE_ARGS, outName];
  // The blur needs the trimmed frame on two branches at once, which a linear `-vf` chain cannot
  // express — hence the graph, and the explicit `-map` naming the label it ends on.
  return ["-i", inName, "-filter_complex", `[0:v]${trimChain},${blurFilterChain(blur)}`, "-map", "[blurout]", ...ENCODE_ARGS, outName];
}

/** Whether the trim can be served by copying the source's own frames rather than re-encoding them:
 * only when the cut is allowed to land on a keyframe and nothing has to be drawn into the picture.
 * A stream copy skips straight to the selection, where a re-encode reads the source up to it. */
export function streamCopies(trim: TrimMode, blur: BlurRegion[]): boolean {
  return trim === "fast" && !blur.length;
}

/** One report from ffmpeg's progress line: `time` is the output timestamp it has reached, in
 * microseconds. */
export interface FfmpegProgress {
  progress: number;
  time: number;
}

/** Re-derives a 0..1 fraction of the file being written from one of those reports, or null while
 * there is nothing to measure yet.
 *
 * ffmpeg's own `progress` number is that output timestamp over the *input's* duration, which is the
 * fraction of the source the cut covers rather than the fraction of the cut that is done: a three
 * second snippet taken out of a half-minute recording climbs to a tenth and then jumps to 1 when the
 * process exits, however long the encode took. Only `time` follows the encode itself, so the
 * fraction is taken from it against the duration this command is expected to write. Until the first
 * frame is muxed `time` arrives as AV_NOPTS_VALUE (INT64_MAX, well past the largest integer a double
 * holds exactly), which is a placeholder rather than a measurement of anything. */
export function encodedFraction({ time }: FfmpegProgress, outputSeconds: number): number | null {
  if (!Number.isFinite(time) || time < 0 || time > Number.MAX_SAFE_INTEGER) return null;
  if (!(outputSeconds > 0)) return null;
  return Math.min(1, time / 1e6 / outputSeconds);
}

export interface EnsureFfmpegHandlers {
  onLog?: (message: string) => void;
  onProgress?: (progress: FfmpegProgress) => void;
}

/** Lazily loads and returns a shared ffmpeg.wasm instance, (re-)wiring log/progress callbacks on
 * every call since a fresh extraction may want fresh handlers. */
export async function ensureFfmpeg(handlers: EnsureFfmpegHandlers = {}): Promise<FFmpeg> {
  currentHandlers = handlers;
  if (!ffmpegInstance) {
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => currentHandlers.onLog?.(message));
    ff.on("progress", (event) => currentHandlers.onProgress?.(event));
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
