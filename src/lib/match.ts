import type { SleapLabels, SleapVideo } from "./types";

// Does a loaded pose file actually describe the video sitting in the player? A `.slp` records the
// video it was labeled against — its frame count, frame size, fps and filename — so the pair can be
// checked before any of it is drawn, extracted, or uploaded. Overlaying pose from one recording onto
// another produces annotations that look plausible and are wrong everywhere.
//
// The answer comes in two tiers, because the recorded facts are not equally telling. A frame count
// or frame size that disagrees is proof of a different recording, and {@link slpVideoMismatches}
// refuses the pair on it. A name that disagrees is only a suggestion — copies get renamed and
// re-encoded on the way between machines — so it goes to {@link slpVideoWarnings}, which the card
// shows alongside a file it loaded anyway.
//
// An `.nwb` carries less: the ndx-pose predictions flavor records the video's filename and nothing
// else about it, so the shape checks below have nothing to compare until lib/nwb.ts supplies the
// pose series length — see `seriesLength`.

/** What a pose file says about the video it was labeled against. Every field is nullable: the file
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
  /** How many videos the file references; > 1 means the comparison used one of several. */
  videoCount: number;
  /** Samples in an `.nwb`'s pose series, read from the data array itself rather than from anything
   * the file says about the video (see lib/nwb.ts). Null for a `.slp`, and for an `.nwb` whose
   * series could not be measured. */
  seriesLength: number | null;
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

/** How to name the loaded file in a notice the reader sees. The two formats say different things
 * about the same pair, so the notices name the one in hand rather than a generic "pose file". */
export type PoseFileKind = ".slp" | ".nwb";

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

/** The video a `.slp`'s labels belong to: the one its labeled frames point at, falling back to the
 * first video it lists (which is the only one, in the single-video files this app is given). */
function labeledVideo(labels: SleapLabels): SleapVideo | null {
  for (const lf of labels.labeledFrames) if (lf.video) return lf.video;
  return labels.videos?.at(0) ?? null;
}

/** Reads the source-video facts out of a parsed pose file. `seriesLength` is the one fact that does
 * not come from the labels — lib/nwb.ts measures it off an `.nwb`'s data array — so it is passed
 * in rather than derived. */
export function slpSourceMeta(labels: SleapLabels, seriesLength: number | null = null): SlpSourceMeta {
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
    seriesLength: positive(seriesLength),
  };
}

/**
 * Disagreements that make the pair unusable together: the `.slp` describes a different recording,
 * so its frame indices and coordinates do not name anything in the loaded video. Anything the
 * `.slp` did not record is skipped rather than guessed at.
 */
export function slpVideoMismatches(slp: SlpSourceMeta, video: LoadedVideoMeta): MetadataMismatch[] {
  const mismatches: MetadataMismatch[] = [];
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
  // A pose series longer than the video has samples for frames the video does not have, which no
  // sparse-labeling story explains — it was sampled over a longer recording. The other direction is
  // not proof of anything (a series may legitimately cover part of a video) and is warned about
  // instead.
  if (frames !== null && slp.seriesLength !== null && slp.seriesLength > frames) {
    mismatches.push({ field: "Pose samples", slp: `${slp.seriesLength} samples`, video: `${frames} frames` });
  }
  return mismatches;
}

/**
 * Differences worth flagging but not worth refusing: none of them can put a pose on the wrong frame
 * or the wrong pixel, and a renamed or re-encoded video is routine. Written as whole sentences,
 * since the card shows them to the reader as they are.
 */
export function slpVideoWarnings(slp: SlpSourceMeta, video: LoadedVideoMeta, kind: PoseFileKind = ".slp"): string[] {
  const warnings: string[] = [];
  // A name is the weakest of the identifiers (the format records no checksum of the video, and a
  // copy gets renamed on the way between machines), so a difference here is a prompt to look rather
  // than grounds to refuse: the frame count and frame size are what actually decide the pairing.
  const name = baseName(video.name);
  if (name && slp.filename && name.toLowerCase() !== slp.filename.toLowerCase()) {
    warnings.push(`The ${kind} was labeled against "${slp.filename}", but the loaded video is "${name}".`);
  }
  const fps = positive(video.fps);
  if (fps !== null && slp.fps !== null && Math.abs(slp.fps - fps) / fps > FPS_TOLERANCE) {
    warnings.push(`The ${kind} records ${slp.fps.toFixed(2)} fps; the video reports ${fps.toFixed(2)} fps.`);
  }
  if (slp.videoCount > 1) {
    warnings.push(`The ${kind} references ${slp.videoCount} videos; it was checked against the one its labels belong to.`);
  }
  // ndx-pose samples a pose series once per video frame, so a series shorter than the video is
  // either pose for part of it or pose for a different, shorter recording. The two are not
  // distinguishable from the file, and only one of them is a problem, so this says what it sees
  // rather than refusing.
  const frames = positive(video.frames);
  if (frames !== null && slp.seriesLength !== null && slp.seriesLength < frames) {
    warnings.push(`The ${kind} holds ${slp.seriesLength} pose samples for a video of ${frames} frames.`);
  }
  return warnings;
}
