import { version as TOOL_VERSION } from "../../package.json";
import type { ArchiveUser } from "./users";

// A small sidecar written beside every upload, so a clip found later in the archive can be traced
// back to who made it, which video it came from, and exactly which frames it covers — even when
// the original video itself was not uploaded alongside it.

export const PROVENANCE_FILENAME = "provenance.json";
export const PROVENANCE_FORMAT = "clip-extractor-provenance/v1";

/** DANDI's own blob digest, so a recorded checksum can be compared against archive metadata
 * directly (it is a multipart-aware ETag, not a plain MD5 of the file). */
export interface ProvenanceChecksum {
  algorithm: "dandi-etag";
  value: string;
}

export interface ProvenanceSource {
  filename: string;
  /** The URL a streamed source came from, or null for a local file. */
  url: string | null;
  size_bytes: number | null;
  checksum: ProvenanceChecksum | null;
  /** Why no checksum is recorded; null whenever `checksum` is present. */
  checksum_unavailable: string | null;
  uploaded: boolean;
  /** Where the original landed, or null when it was not uploaded. */
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

export interface ProvenanceAnnotations {
  skeleton_node_count: number;
  track_count: number;
  labeled_frames_in_selection: number;
}

export interface ProvenanceDocument {
  format: string;
  created_at: string;
  tool: { name: string; version: string; page_url: string | null };
  /** Null only when the archive could not name the signed-in account. */
  uploaded_by: ArchiveUser | null;
  destination: { api: string; dandiset_id: string; directory: string };
  source_video: ProvenanceSource;
  selection: ProvenanceSelection;
  extracted: ProvenanceExtracted;
  /** Null when no SLEAP annotations were loaded for this selection. */
  annotations: ProvenanceAnnotations | null;
}

export interface ProvenanceInput {
  createdAt: Date;
  pageUrl: string | null;
  user: ArchiveUser | null;
  api: string;
  dandisetId: string;
  directory: string;
  mode: "snippet" | "frame";
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  /** Inclusive source-frame bounds of the selection. */
  inFrame: number;
  outFrame: number;
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
  annotations: ProvenanceAnnotations | null;
}

function checksum(value: string | null): ProvenanceChecksum | null {
  return value ? { algorithm: "dandi-etag", value } : null;
}

export function buildProvenance(input: ProvenanceInput): ProvenanceDocument {
  const numFrames = input.outFrame - input.inFrame + 1;
  return {
    format: PROVENANCE_FORMAT,
    created_at: input.createdAt.toISOString(),
    tool: { name: "clip-extractor", version: TOOL_VERSION, page_url: input.pageUrl },
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
    extracted: {
      filename: input.extracted.filename,
      asset_path: input.extracted.assetPath,
      media_type: input.extracted.mediaType,
      size_bytes: input.extracted.sizeBytes,
      // Non-null by construction: the extracted file is always checksummed on its way up.
      checksum: checksum(input.extracted.checksum)!,
      encoding: input.extracted.encoding,
    },
    annotations: input.annotations,
  };
}
