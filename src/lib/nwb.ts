import type { PoseModel } from "./types";

// What an NWB (ndx-pose) file records about the video, and what has to be recovered by hand.
//
// sleap-io.js reads both ndx-pose flavors, but they do not carry the same evidence about the source
// video. A `PoseTraining` file names an `ImageSeries` with `num_samples` and `dimension`, so the
// reader hands back a video with a real `[frames, height, width, channels]` shape and lib/match.ts
// can check the pair the same way it checks a `.slp`. A `PoseEstimation` file records only the
// original video's filename, and the reader drops the one number that would stand in for a frame
// count: the length of each `PoseEstimationSeries`.
//
// That length is the fact worth having. A `PoseEstimationSeries` is sampled once per video frame,
// so its first axis IS the video's frame count, and sample `i` is frame `i`. This module reads it
// straight out of the HDF5 — a shallow walk over `/processing/*/*`, no values decoded — and uses it
// for both jobs: the frame-count comparison in lib/match.ts, and {@link alignDenseFrames} below.
//
// The walk is split from the h5wasm plumbing so it can be tested against a plain object literal
// rather than a real HDF5 file. h5wasm itself is already in the bundle — sleap-io.js loads it to
// read `.slp` and `.nwb` alike — so reaching for it directly costs a dependency entry, not weight.

/** The read-only slice of h5wasm's `Group`/`Dataset` surface this walk touches. Groups answer
 * `keys()`, datasets carry a `shape`, and both carry `attrs`; anything else is ignored. */
export interface H5Entity {
  keys?: () => string[];
  get?: (path: string) => H5Entity | null;
  attrs?: Record<string, { value?: unknown } | undefined>;
  shape?: number[] | null;
}

function isGroup(entity: H5Entity | null | undefined): entity is H5Entity & { keys: () => string[] } {
  return entity != null && typeof entity.keys === "function";
}

/** NWB stamps every container with the type it is; the walk follows that rather than guessing from
 * names, since the group names are the track and node names. */
function neurodataType(entity: H5Entity | null | undefined): string | null {
  const raw: unknown = entity?.attrs?.neurodata_type?.value;
  // h5wasm hands a scalar string attribute back either bare or as a one-element array. The cast is
  // what keeps the element `unknown`: narrowing an `unknown` with Array.isArray() gives `any[]`.
  const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  return typeof value === "string" ? value : null;
}

/**
 * Length of the `PoseEstimationSeries` data in an open NWB file — the number of samples, which for
 * the once-per-frame series ndx-pose writes is the source video's frame count. Null when the file
 * holds no predictions (a `PoseTraining`-only file, which records its video's shape directly) or
 * stores no readable data shape.
 *
 * The longest series wins when a file holds several: they are per-node and per-track series over
 * one video, so they agree in the normal case, and taking the longest keeps a short or truncated
 * one from understating the video.
 */
export function poseSeriesLength(root: H5Entity): number | null {
  const processing = root.get?.("processing");
  if (!isGroup(processing)) return null;
  let longest: number | null = null;
  for (const modKey of processing.keys()) {
    const mod = root.get?.(`processing/${modKey}`);
    if (!isGroup(mod)) continue;
    for (const poseKey of mod.keys()) {
      const posePath = `processing/${modKey}/${poseKey}`;
      const pose = root.get?.(posePath);
      if (!isGroup(pose) || neurodataType(pose) !== "PoseEstimation") continue;
      for (const seriesKey of pose.keys()) {
        const seriesPath = `${posePath}/${seriesKey}`;
        if (neurodataType(root.get?.(seriesPath)) !== "PoseEstimationSeries") continue;
        // `data` is (samples, 2) — only the first axis is wanted, and reading `shape` never
        // touches the values.
        const frames = root.get?.(`${seriesPath}/data`)?.shape?.[0];
        if (typeof frames === "number" && frames > 0 && (longest === null || frames > longest)) longest = frames;
      }
    }
  }
  return longest;
}

/** Unique name per open, so two pose files being read at once cannot land on the same path in
 * h5wasm's in-memory filesystem. */
let probeSeq = 0;

/**
 * Reads {@link poseSeriesLength} out of NWB file bytes. Returns null rather than throwing when the
 * file cannot be opened at all: this only sharpens the checks in lib/match.ts, and a pose file that
 * is genuinely unreadable fails on the load itself, where the card can say so.
 */
export async function probeNwbSeriesLength(bytes: ArrayBuffer): Promise<number | null> {
  const h5 = await import("h5wasm");
  await h5.ready;
  const path = `/nwb-probe-${probeSeq++}.nwb`;
  const fs = h5.FS as { writeFile: (p: string, d: Uint8Array) => void; unlink: (p: string) => void } | null;
  if (!fs) return null;
  let file: InstanceType<typeof h5.File> | null = null;
  try {
    fs.writeFile(path, new Uint8Array(bytes));
    file = new h5.File(path, "r");
    return poseSeriesLength(file as unknown as H5Entity);
  } catch (e) {
    console.warn("NWB series length could not be read", e);
    return null;
  } finally {
    file?.close();
    try {
      fs.unlink(path);
    } catch {
      // Nothing was written, or it is already gone — either way there is nothing to clean up.
    }
  }
}

/**
 * Puts a dense `PoseEstimation` file's labels back on the frames they belong to.
 *
 * ndx-pose stores a sample's position as a timestamp, and sleap-io.js recovers a frame index from
 * it by rounding — which is right when the writer stored frame numbers, and right again when real
 * seconds round into collisions and it falls back to sample order. It is wrong in the narrow case
 * between the two: real seconds far enough apart to round to distinct integers (a series slower
 * than about 1 fps) come out as frames 0, 2, 4, … for samples 0, 1, 2, ….
 *
 * The series length settles it without consulting the timestamps at all. A series as long as the
 * video, every sample of which became a labeled frame, is one sample per frame — so the k-th frame
 * in order is frame k, whatever the timestamps said. Anything else is left alone: a shorter series
 * may be genuinely sparse, and there the recorded indices are the only thing that knows which
 * frames were labeled.
 *
 * Re-running this on an already-aligned model is a no-op, so it is safe to apply again whenever the
 * video underneath changes.
 */
export function alignDenseFrames(pose: PoseModel, seriesLength: number | null, videoFrames: number | null): PoseModel {
  if (seriesLength === null || videoFrames === null || seriesLength !== videoFrames) return pose;
  if (pose.byFrame.size !== seriesLength) return pose;
  const frames = [...pose.byFrame.keys()].sort((a, b) => a - b);
  if (frames.every((frame, i) => frame === i)) return pose;
  const byFrame = new Map(frames.map((frame, i) => [i, pose.byFrame.get(frame)!]));
  return { ...pose, byFrame };
}
