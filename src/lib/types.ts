// Domain types shared across the player, extraction, and payload modules. Kept independent of
// any single UI framework — main.ts and ui/* are the only places that touch the DOM.

// Type-only, so this stays a leaf module at runtime: the stored-settings shape needs the delivery
// mode's union without pulling lib/delivery.ts into the bundle graph here.
import type { StoredArchiveSettings } from "@brain-bbqs/ember-client";
import type { DeliveryMode } from "./delivery";

/** What lib/settings.ts stores: the archive client's slice (the picked dataset and the OAuth token
 * set) plus this app's own preferences. */
export interface StoredSettings extends StoredArchiveSettings {
  /** The Download/Upload side the visitor last picked themselves, so a refresh does not hand them
   * back to whichever side the sign-in state would have defaulted to. */
  deliveryMode?: DeliveryMode;
  /** How much of a long recording the timeline covers either side of the overview slider, in
   * seconds. A working preference rather than a property of any one video, so it is remembered
   * across loads and sessions. */
  windowHalfSeconds?: number;
}

/** Minimal duck-typed surface of sleap-io.js's video backend that this app actually calls. The
 * upstream package's generated declarations are heavily mangled/overloaded; re-declaring just the
 * members used here keeps the rest of the codebase strictly typed without fighting that. */
export interface SleapVideoBackend {
  numFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  shape?: number[];
  // See the getFrameTimes comment below: typed loosely because a real backend can resolve
  // null/undefined on a decode failure even though the common case always returns a frame.
  getFrame(index: number): Promise<VideoFrameLike | null | undefined>;
  // Typed loosely (rather than a bare Promise<number[]>): real backends occasionally resolve
  // null/undefined here instead of an empty array, and buildFrameOrder()'s defensive check
  // depends on that being a real possibility as far as the type checker is concerned.
  getFrameTimes?(): Promise<number[] | null | undefined>;
  prefetch?(startIndex: number, endIndex: number): Promise<void>;
  /** Releases decoded frames and any reads still in flight. Optional: not every backend has one. */
  close?(): void;
}

/** A decoded frame as returned by {@link SleapVideoBackend.getFrame} — sleap-io.js backends may
 * hand back any of these depending on codec/backend. */
export type VideoFrameLike = ImageBitmap | ImageData | ArrayBuffer | { buffer: ArrayBufferLike };

/** Which selector the player is on: "video" marks an in/out range (streamed directly, with no
 * re-encoding), "frame" marks a single frame. The mode only changes what the selector means —
 * playback works the same in both. */
export type SelectorMode = "video" | "frame";

export interface SleapPoint {
  xy: [number, number];
  visible: boolean;
  score?: number | null;
}

export interface SleapInstance {
  track?: SleapTrack | null;
  score?: number | null;
  points?: (SleapPoint | null | undefined)[];
}

export interface SleapTrack {
  name: string;
}

/** The video a `.slp` was labeled against, as recorded in the file itself. `shape` is SLEAP's
 * `[frames, height, width, channels]`; every field is optional because a `.slp` only carries what
 * its writer stored, and none of it is re-derived here (the videos are not opened on load). */
export interface SleapVideo {
  filename?: string | string[];
  shape?: [number, number, number, number] | null;
  fps?: number | null;
}

export interface SleapLabeledFrame {
  frameIdx: number;
  instances: SleapInstance[];
  /** Which of `SleapLabels.videos` this frame belongs to, when the file names one. */
  video?: SleapVideo;
}

export interface SleapSkeleton {
  name?: string;
  nodeNames?: string[];
  edgeIndices?: [number, number][];
}

export interface SleapLabels {
  skeletons: SleapSkeleton[];
  tracks: SleapTrack[];
  labeledFrames: SleapLabeledFrame[];
  videos?: SleapVideo[];
}

// ------------------------------------------------------------------
// SLP-free pose model built once from a loaded Labels (see lib/pose.ts)
// ------------------------------------------------------------------

export interface PosePoint {
  x: number;
  y: number;
  score: number | null;
}

export interface PoseInstance {
  /** Index into PoseModel.tracks, or -1 if untracked. */
  track: number;
  kind: "predicted" | "user";
  score: number | null;
  points: (PosePoint | null)[];
}

export interface PoseSkeleton {
  name: string;
  nodes: string[];
  edges: [number, number][];
}

export interface PoseModel {
  skeleton: PoseSkeleton;
  tracks: string[];
  byFrame: Map<number, PoseInstance[]>;
}

// ------------------------------------------------------------------
// Extraction
// ------------------------------------------------------------------

/** How a snippet is cut: "precise" re-encodes for a frame-exact cut, "fast" stream-copies from the
 * nearest keyframe (see lib/ffmpeg.ts). */
export type TrimMode = "precise" | "fast";
