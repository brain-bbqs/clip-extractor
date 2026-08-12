import type { SleapLabels, SleapVideo } from "./types";

// Does a loaded `.slp` actually describe the video sitting in the player? A `.slp` records the
// video it was labeled against — its frame count, frame size, fps and filename — so the pair can be
// checked before any of it is drawn, extracted, or uploaded. Overlaying pose from one recording onto
// another produces annotations that look plausible and are wrong everywhere, which is worth
// refusing rather than warning about.

/** What a `.slp` says about the video it was labeled against. Every field is nullable: a `.slp`
 * carries whatever its writer stored, and older/hand-built files often record only a filename. */
export interface SlpSourceMeta {
  /** Basename of the labeled video, or null when the file records none. */
  filename: string | null;
  frames: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  /** Highest frame index the file actually labels, or null when it labels nothing. Checkable even
   * when no shape was stored. */
  maxLabeledFrame: number | null;
  /** How many videos the `.slp` references; > 1 means the comparison used one of several. */
  videoCount: number;
}

/** The same facts about the video currently open in the player. */
export interface LoadedVideoMeta {
  name: string;
  frames: number;
  width: number;
  height: number;
  fps: number;
}

/** One field where the two disagree, in a shape the SLEAP card can render as a row. */
export interface MetadataMismatch {
  field: string;
  slp: string;
  video: string;
}

/** fps is stored as a float and re-derived from the container on load, so 29.97 against 30 is a
 * rounding difference rather than a different recording. Only a gap wider than this is worth
 * mentioning, and even then only as a warning — it cannot misalign a frame index. */
const FPS_TOLERANCE = 0.02;

function positive(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/** Last path segment of a `.slp`'s recorded video filename (which is an array for an image
 * sequence), with both separators handled since the path was written on whatever OS labeled it. */
function baseName(filename: string | string[] | undefined): string | null {
  const first = Array.isArray(filename) ? filename.at(0) : filename;
  if (!first) return null;
  const name = first.split(/[\\/]/).pop() ?? "";
  return name || null;
}

/** A filename reduced to what survives a re-encode: no directory, no extension, case-folded. The
 * `.slp` records an absolute path from whichever machine labeled it, and a lab's copy of the same
 * recording is routinely `mice.avi` next to `mice.mp4`, so the container is not identifying. */
function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

/** The video a `.slp`'s labels belong to: the one its labeled frames point at, falling back to the
 * first video it lists (which is the only one, in the single-video files this app is given). */
function labeledVideo(labels: SleapLabels): SleapVideo | null {
  for (const lf of labels.labeledFrames) if (lf.video) return lf.video;
  return labels.videos?.at(0) ?? null;
}

/** Reads the source-video facts out of a parsed `.slp`. */
export function slpSourceMeta(labels: SleapLabels): SlpSourceMeta {
  const video = labeledVideo(labels);
  // shape is SLEAP's [frames, height, width, channels].
  const shape = video?.shape ?? null;
  let maxLabeledFrame: number | null = null;
  for (const lf of labels.labeledFrames) {
    // With several videos in one file, only the labels on the compared video bound its length.
    if (video && lf.video && lf.video !== video) continue;
    if (Number.isFinite(lf.frameIdx) && (maxLabeledFrame === null || lf.frameIdx > maxLabeledFrame)) maxLabeledFrame = lf.frameIdx;
  }
  return {
    filename: baseName(video?.filename),
    frames: positive(shape?.[0]),
    height: positive(shape?.[1]),
    width: positive(shape?.[2]),
    fps: positive(video?.fps),
    maxLabeledFrame,
    videoCount: labels.videos?.length ?? 0,
  };
}

/**
 * Disagreements that make the pair unusable together: the `.slp` describes a different recording,
 * so its frame indices and coordinates do not name anything in the loaded video. Anything the
 * `.slp` did not record is skipped rather than guessed at.
 */
export function slpVideoMismatches(slp: SlpSourceMeta, video: LoadedVideoMeta): MetadataMismatch[] {
  const mismatches: MetadataMismatch[] = [];
  // The name is the only identifier a `.slp` always carries — the format records no checksum of the
  // video, so there is nothing stronger to compare. It is also the only check that fires on a file
  // that stored no shape at all, which is exactly the file most able to be paired with the wrong
  // video unnoticed.
  const name = baseName(video.name);
  if (name && slp.filename && stem(name) !== stem(slp.filename)) {
    mismatches.push({ field: "Video file", slp: `"${slp.filename}"`, video: `"${name}"` });
  }
  const frames = positive(video.frames);
  if (frames !== null && slp.frames !== null && slp.frames !== frames) {
    mismatches.push({ field: "Frame count", slp: `${slp.frames} frames`, video: `${frames} frames` });
  } else if (frames !== null && slp.maxLabeledFrame !== null && slp.maxLabeledFrame >= frames) {
    // No stored frame count (or one that agrees), but the labels themselves run past the end of
    // the video — the file cannot be describing it.
    mismatches.push({
      field: "Labeled frames",
      slp: `labels up to frame ${slp.maxLabeledFrame}`,
      video: `last frame is ${frames - 1}`,
    });
  }
  const width = positive(video.width);
  const height = positive(video.height);
  if (width !== null && height !== null && slp.width !== null && slp.height !== null && (slp.width !== width || slp.height !== height)) {
    mismatches.push({ field: "Frame size", slp: `${slp.width}×${slp.height}`, video: `${width}×${height}` });
  }
  return mismatches;
}

/**
 * Differences worth reporting but not worth refusing: none of them can misplace a pose on a frame,
 * and all are routine for a video that was re-encoded after it was labeled.
 */
export function slpVideoWarnings(slp: SlpSourceMeta, video: LoadedVideoMeta): string[] {
  const warnings: string[] = [];
  const fps = positive(video.fps);
  if (fps !== null && slp.fps !== null && Math.abs(slp.fps - fps) / fps > FPS_TOLERANCE) {
    warnings.push(`the .slp records ${slp.fps.toFixed(2)} fps, the video reports ${fps.toFixed(2)} fps`);
  }
  const name = baseName(video.name);
  if (name && slp.filename && name.toLowerCase() !== slp.filename.toLowerCase() && stem(name) === stem(slp.filename)) {
    warnings.push(`the .slp was labeled against "${slp.filename}", the loaded video is "${name}"`);
  }
  if (slp.videoCount > 1)
    warnings.push(`the .slp references ${slp.videoCount} videos; it was checked against the one its labels belong to`);
  return warnings;
}
