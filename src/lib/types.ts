// Domain types shared across the player, extraction, and payload modules. Kept independent of
// any single UI framework — main.ts and ui/* are the only places that touch the DOM.

// ------------------------------------------------------------------
// EMBER archive sign-in and upload destination (see lib/oauth.ts, lib/dandisets.ts)
// ------------------------------------------------------------------

export interface DandiInstance {
  api: string;
  web: string;
  oauth: string;
}

export interface ArchiveConfig {
  api: string;
  web: string;
  accessToken: string;
  dandisetId: string;
  /** Whether the selected dandiset is embargoed, if known. Undefined when not yet resolved. */
  embargoed?: boolean;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt: number;
}

// Type-only, so this stays a leaf module at runtime: the stored-settings shape needs the delivery
// mode's union without pulling lib/delivery.ts into the bundle graph here.
import type { DeliveryMode } from "./delivery";

export interface StoredSettings {
  dandisetId?: string;
  oauth?: OAuthTokenSet;
  /** The Download/Upload side the visitor last picked themselves, so a refresh does not hand them
   * back to whichever side the sign-in state would have defaulted to. */
  deliveryMode?: DeliveryMode;
  /** How much of a long recording the timeline covers either side of the overview slider, in
   * seconds. A working preference rather than a property of any one video, so it is remembered
   * across loads and sessions. */
  windowHalfSeconds?: number;
}

// ------------------------------------------------------------------
// Archive upload (see lib/etag.ts, lib/upload.ts)
// ------------------------------------------------------------------

/** One slice of a blob in the S3 multipart layout: `number` is 1-based, like S3's part numbers. */
export interface FilePart {
  number: number;
  offset: number;
  size: number;
}

export interface ServerPart {
  part_number: number;
  size: number;
  upload_url: string;
}

export interface UploadInitResponse {
  upload_id: string;
  parts: ServerPart[];
}

export interface CompletedPart {
  part_number: number;
  size: number;
  etag: string;
}

export interface Asset {
  asset_id: string;
  path: string;
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
// Extraction outputs
// ------------------------------------------------------------------

export type OutputKind = "clip" | "frames";
export type TrimMode = "precise" | "fast";
export type ImageFormat = "image/png" | "image/jpeg";
export type PackagingType = "pozu" | "multipart" | "json";

export interface ExtractedClip {
  kind: "clip";
  blob: Blob;
  name: string;
  mime: string;
}

export interface ExtractedFrame {
  source_frame: number;
  clip_frame: number;
  blob: Blob;
}

export interface ExtractedFrames {
  kind: "frames";
  frames: ExtractedFrame[];
  ext: string;
  mime: ImageFormat;
  name: string;
}

export type Extracted = ExtractedClip | ExtractedFrames;

// ------------------------------------------------------------------
// Annotations JSON (SLP-free, clip-relative)
// ------------------------------------------------------------------

export interface AnnotationsPointOut {
  node: string;
  xy: [number, number] | null;
  visible: boolean;
  score: number | null;
}

export interface AnnotationsInstanceOut {
  track: number | null;
  track_name: string | null;
  kind: "predicted" | "user";
  score: number | null;
  points: AnnotationsPointOut[];
}

export interface AnnotationsFrameOut {
  clip_frame: number;
  source_frame: number;
  instances: AnnotationsInstanceOut[];
}

export interface AnnotationsDocument {
  format: "sleap-clip-annotations/v1";
  clip: {
    source: string;
    source_url: string | null;
    original_filename: string | null;
    author: string | null;
    in_frame: number;
    out_frame: number;
    num_frames: number;
    fps: number;
    width: number;
    height: number;
    extracted_at: string;
  };
  skeleton: PoseSkeleton | null;
  tracks: string[];
  labeled_frame_count: number;
  frames: AnnotationsFrameOut[];
}

export interface PayloadMetadata {
  source: string;
  source_url: string | null;
  original_filename: string | null;
  author: string | null;
  in_frame: number;
  out_frame: number;
  num_frames: number;
  fps: number;
  width: number;
  height: number;
  media_kind: OutputKind | null;
  media_mime: string | null;
  frame_count: number;
  has_annotations: boolean;
  created_at: string;
}
