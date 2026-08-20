import { version as TOOL_VERSION } from "../../package.json";
import type { BlurRegion } from "./blur";
import type { ArchiveUser } from "./users";
import { DERIVATIVES_PIPELINE } from "./bidsPath";
import { buildGeneratedByEntry, type GeneratedByEntry, type GeneratedBySourceVideo } from "./generatedBy";

// A small sidecar written beside every upload, so a clip found later in the archive can be traced
// back to who made it, which video it came from, and exactly which frames it covers — even when
// the original video itself was not uploaded alongside it.

export const PROVENANCE_FORMAT = "clip-extractor-provenance/v1";

/**
 * DANDI's own blob digest, recorded under the exact identifier the archive uses for it so a value
 * here can be compared against archive metadata (and the `digest` this app sends to
 * `/uploads/initialize/`) without translation.
 *
 * Deliberately *not* labelled `md5`: a dandi-etag is the S3 multipart ETag — MD5 of the
 * concatenated per-part MD5s, suffixed with the part count — so it does not equal `md5(file)` even
 * for a single-part file. The `-<n>` suffix is the giveaway. See lib/etag.ts.
 */
export interface ProvenanceChecksum {
  algorithm: "dandi:dandi-etag";
  value: string;
}

export interface ProvenanceSource {
  /**
   * Base name only, never a path: a browser exposes `File.name` and nothing else for a picked or
   * dropped file (`input.value` is deliberately fabricated as `C:\fakepath\…`, and
   * `webkitRelativePath` is populated only for directory pickers, which this app does not use). So
   * the checksum below — not the name — is what identifies the source video again later.
   */
  filename: string;
  /** The URL a streamed source came from, or null for a local file. This is the one case where the
   * full location is knowable, since it came from the page rather than the filesystem. */
  url: string | null;
  size_bytes: number | null;
  checksum: ProvenanceChecksum | null;
  /** Why no checksum is recorded; null whenever `checksum` is present. */
  checksum_unavailable: string | null;
  /** Whether the original travelled with the extract — registered as an asset by an upload, or
   * packed into the saved bundle. */
  uploaded: boolean;
  /** Where the original landed, or null when it did not travel along. */
  asset_path: string | null;
  fps: number;
  width: number;
  height: number;
  num_frames: number;
}

export interface ProvenanceSelection {
  mode: "snippet" | "frame";
  /** Inclusive source-frame bounds; equal to each other in frame mode. */
  in_frame: number;
  out_frame: number;
  num_frames: number;
  duration_seconds: number;
}

export interface ProvenanceExtracted {
  filename: string;
  asset_path: string;
  media_type: string;
  size_bytes: number;
  checksum: ProvenanceChecksum;
  /** How the file was produced — the literal ffmpeg command for a snippet. */
  encoding: string;
}

/** A rendered variant of the selection — currently the pose-overlay version. */
export interface ProvenanceRendered {
  filename: string;
  asset_path: string;
  media_type: string;
  size_bytes: number;
  checksum: ProvenanceChecksum;
  encoding: string;
}

/**
 * What was blurred out of every file this delivery wrote, and how hard. Recorded because a
 * de-identified clip is only trustworthy if what was removed from it is stated: a reader can see
 * which parts of the frame carry no data, and nobody has to guess whether an unblurred copy exists
 * (the original never travels with a blurred selection — see main.ts).
 *
 * Coordinates are in source-video pixels, with the origin at the top-left of the frame.
 */
export interface ProvenanceBlur {
  method: "gaussian";
  /** Standard deviation in pixels, applied at the same strength to every region. */
  sigma: number;
  regions: BlurRegion[];
}

export interface ProvenanceAnnotations {
  /** The `.slp` the annotations were read from, or null when it came from a URL rather than a local
   * file (in which case there are no local bytes to name, checksum or upload). */
  filename: string | null;
  checksum: ProvenanceChecksum | null;
  /** As on the source video: registered as an asset, or packed into the saved bundle. */
  uploaded: boolean;
  /** Where the `.slp` landed, or null when it did not travel along. */
  asset_path: string | null;
  skeleton_node_count: number;
  track_count: number;
  labeled_frames_in_selection: number;
}

/** The annotation fields buildProvenance takes, before the checksum is wrapped. */
export interface ProvenanceAnnotationsInput {
  filename: string | null;
  checksum: string | null;
  uploaded: boolean;
  assetPath: string | null;
  skeletonNodeCount: number;
  trackCount: number;
  labeledFramesInSelection: number;
}

/** Where the files went. A saved bundle has no archive behind it, so it names only the directory —
 * the same tree an upload would have written, one level inside the `.tar.gz`. */
export interface ProvenanceDestination {
  api: string | null;
  dandiset_id: string | null;
  directory: string;
}

export interface ProvenanceDocument {
  format: string;
  created_at: string;
  tool: { name: string; version: string; page_url: string | null };
  /** What the person extracting wrote about this selection — the event it shows, what went wrong in
   * it, anything else worth passing on with it. The interface will not send a selection without
   * one, so this is null only for a record written some other way. */
  description: string | null;
  /** Null for a saved bundle, which nobody uploaded, and when the archive could not name the
   * signed-in account. */
  uploaded_by: ArchiveUser | null;
  destination: ProvenanceDestination;
  source_video: ProvenanceSource;
  selection: ProvenanceSelection;
  /** Null when nothing was blurred, which is the ordinary case for a dataset that holds no
   * recordings of people. */
  blur: ProvenanceBlur | null;
  extracted: ProvenanceExtracted;
  /** The same selection with the pose drawn into the pixels; null when no annotations were loaded,
   * since there would be nothing to draw. */
  overlay: ProvenanceRendered | null;
  /** Null when no SLEAP annotations were loaded for this selection. */
  annotations: ProvenanceAnnotations | null;
}

export interface ProvenanceInput {
  createdAt: Date;
  pageUrl: string | null;
  /** Free text from the description field; trimmed here, and blank counts as none. */
  description: string | null;
  user: ArchiveUser | null;
  /** Both null for a saved bundle, which is not bound for an archive. */
  api: string | null;
  dandisetId: string | null;
  directory: string;
  mode: "snippet" | "frame";
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  /** Inclusive source-frame bounds of the selection. */
  inFrame: number;
  outFrame: number;
  /** Areas blurred into every file written, in source pixels; empty when nothing was blurred. */
  blur?: BlurRegion[];
  /** The strength they were blurred at, from lib/blur.ts. Ignored when `blur` is empty. */
  blurSigma?: number;
  source: {
    filename: string;
    url: string | null;
    sizeBytes: number | null;
    /** The original's dandi-etag, recorded whether or not the original itself was uploaded. */
    checksum: string | null;
    checksumUnavailable: string | null;
    uploaded: boolean;
    assetPath: string | null;
  };
  extracted: {
    filename: string;
    assetPath: string;
    mediaType: string;
    sizeBytes: number;
    checksum: string;
    encoding: string;
  };
  overlay: {
    filename: string;
    assetPath: string;
    mediaType: string;
    sizeBytes: number;
    checksum: string;
    encoding: string;
  } | null;
  annotations: ProvenanceAnnotationsInput | null;
}

function checksum(value: string | null): ProvenanceChecksum | null {
  return value ? { algorithm: "dandi:dandi-etag", value } : null;
}

/** As much as is known about the source video, in the shape `lib/generatedBy.ts`'s `GeneratedByEntry`
 * carries — the same values `buildProvenance`'s own `source_video` block records, so the two never
 * drift apart. */
export function buildGeneratedBySourceVideo(input: ProvenanceInput): GeneratedBySourceVideo {
  return {
    filename: input.source.filename,
    url: input.source.url,
    size_bytes: input.source.sizeBytes,
    checksum: checksum(input.source.checksum),
    checksum_unavailable: input.source.checksum ? null : input.source.checksumUnavailable,
    fps: input.fps,
    width: input.width,
    height: input.height,
    num_frames: input.totalFrames,
  };
}

export function buildProvenance(input: ProvenanceInput): ProvenanceDocument {
  const numFrames = input.outFrame - input.inFrame + 1;
  return {
    format: PROVENANCE_FORMAT,
    created_at: input.createdAt.toISOString(),
    tool: { name: "clip-extractor", version: TOOL_VERSION, page_url: input.pageUrl },
    description: input.description?.trim() || null,
    uploaded_by: input.user,
    destination: { api: input.api, dandiset_id: input.dandisetId, directory: input.directory },
    source_video: {
      filename: input.source.filename,
      url: input.source.url,
      size_bytes: input.source.sizeBytes,
      checksum: checksum(input.source.checksum),
      checksum_unavailable: input.source.checksum ? null : input.source.checksumUnavailable,
      uploaded: input.source.uploaded,
      asset_path: input.source.assetPath,
      fps: input.fps,
      width: input.width,
      height: input.height,
      num_frames: input.totalFrames,
    },
    selection: {
      mode: input.mode,
      in_frame: input.inFrame,
      out_frame: input.outFrame,
      num_frames: numFrames,
      duration_seconds: input.fps > 0 ? numFrames / input.fps : 0,
    },
    blur: input.blur?.length ? { method: "gaussian", sigma: input.blurSigma ?? 0, regions: input.blur.map((r) => ({ ...r })) } : null,
    extracted: {
      filename: input.extracted.filename,
      asset_path: input.extracted.assetPath,
      media_type: input.extracted.mediaType,
      size_bytes: input.extracted.sizeBytes,
      // Non-null by construction: the extracted file is always checksummed on its way up.
      checksum: checksum(input.extracted.checksum)!,
      encoding: input.extracted.encoding,
    },
    overlay: input.overlay && {
      filename: input.overlay.filename,
      asset_path: input.overlay.assetPath,
      media_type: input.overlay.mediaType,
      size_bytes: input.overlay.sizeBytes,
      // Non-null by construction: an overlay is always checksummed on its way up.
      checksum: checksum(input.overlay.checksum)!,
      encoding: input.overlay.encoding,
    },
    annotations: input.annotations && {
      filename: input.annotations.filename,
      checksum: checksum(input.annotations.checksum),
      uploaded: input.annotations.uploaded,
      asset_path: input.annotations.assetPath,
      skeleton_node_count: input.annotations.skeletonNodeCount,
      track_count: input.annotations.trackCount,
      labeled_frames_in_selection: input.annotations.labeledFramesInSelection,
    },
  };
}

// ------------------------------------------------------------------
// BEP047 sidecar JSON — the file a `_video`/`_image` asset actually carries next to it.
// ------------------------------------------------------------------
//
// BEP047 (https://github.com/bids-standard/bids-specification/pull/2231) defines a handful of
// standard technical keys for a behavioral recording's sidecar (`RecordingDuration`,
// `VideoFrameRate`, `ImageWidth`, …) but says nothing about the rich, tool-specific detail this app
// has always recorded — what was blurred, who uploaded it, which archive asset the source checksums
// against. Rather than inventing a second file for that (the very thing this shape is meant to
// avoid — see CLAUDE.md's brief for this change), it travels in the same sidecar, namespaced under
// this app's own key so nothing here is mistaken for part of the BEP047 vocabulary itself.

/** The subset of BEP047's technical keys that make sense for a video (or the derivatives entity
 * that produced one) — omitted entirely for a still frame, whose sidecar uses
 * {@link imageTechnicalFields} instead. */
export interface VideoTechnicalFields {
  RecordingDuration: number;
  VideoFrameRate: number;
  VideoFrameCount: number;
  ImageWidth: number;
  ImageHeight: number;
}

export function videoTechnicalFields(fps: number, width: number, height: number, numFrames: number): VideoTechnicalFields {
  return {
    RecordingDuration: fps > 0 ? numFrames / fps : 0,
    VideoFrameRate: fps,
    VideoFrameCount: numFrames,
    ImageWidth: width,
    ImageHeight: height,
  };
}

export interface ImageTechnicalFields {
  ImageWidth: number;
  ImageHeight: number;
}

export function imageTechnicalFields(width: number, height: number): ImageTechnicalFields {
  return { ImageWidth: width, ImageHeight: height };
}

/** The full sidecar for the delivery's primary output — the extracted clip or frame itself. Standard
 * BEP047 keys and `GeneratedBy` (BEP028) at the top level, for anything reading only the vocabulary
 * both proposals define; the complete record this app has always kept nested under
 * `clip-extractor`, so nothing from the previous, free-standing provenance file is lost. */
export function buildBehSidecar(input: ProvenanceInput, technical: VideoTechnicalFields | ImageTechnicalFields): Record<string, unknown> {
  return {
    Description: input.description?.trim() || null,
    ...technical,
    GeneratedBy: [buildGeneratedByEntry()],
    [DERIVATIVES_PIPELINE]: buildProvenance(input),
  };
}

/** A lighter sidecar for a companion file — the pose overlay, the original source copied alongside
 * its derivative, or a loaded `.slp` — that only needs to name what it is and point back at whatever
 * it came from, rather than repeat the primary sidecar's whole record a second time. */
export interface CompanionSidecarInput {
  description: string;
  /** Omitted for a file BEP047 has no technical vocabulary for at all — a `.slp`, say — rather than
   * for anything with real dimensions or a frame rate to report. */
  technical?: VideoTechnicalFields | ImageTechnicalFields;
  /** The asset path(s) this file was derived or copied from, relative to the dataset root; empty for
   * the untouched source video itself, which has no upstream to name. */
  sources: string[];
  /** Whether this file was produced by this tool (the overlay) or merely copied by it (the original
   * source, or a `.slp` this app did not generate) — a copy carries no `GeneratedBy`, since the tool
   * did not generate its content. */
  generatedByTool: boolean;
}

export function buildCompanionSidecar(input: CompanionSidecarInput): Record<string, unknown> {
  const sidecar: Record<string, unknown> = {
    Description: input.description,
    ...input.technical,
    Sources: input.sources,
  };
  if (input.generatedByTool) sidecar.GeneratedBy = [buildGeneratedByEntry()] as GeneratedByEntry[];
  return sidecar;
}
