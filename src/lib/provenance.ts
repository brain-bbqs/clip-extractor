import type { ArchiveSource } from "./archives";
import type { SourceDatasetEntry } from "./generatedBy";

// A small sidecar written beside every upload, so a clip found later in the archive can be traced
// back to which video it came from and what the person extracting it wrote about it.
//
// This used to also carry a free-standing, ad hoc "clip-extractor" provenance record (who uploaded
// it, exactly which frames, what was blurred, …) nested under its own key. That record is gone —
// proper W3C PROV records are a later PR's job, and the ad hoc shape here was never going to be how
// that gets done — so this module is left with just what the sidecar's standards-facing keys
// (`Description`, `Checksum`, `GeneratedBy`, `SourceDatasets`) actually need.

/** What a sidecar's own builders need to know about this delivery — only the description typed for
 * it, now that no free-standing provenance record travels with it and the source video's own
 * identity lives in its `Checksum` and in `SourceDatasets` instead (see this module's header). */
export interface ProvenanceInput {
  /** Free text from the description field; trimmed here, and blank counts as none. */
  description: string | null;
}

/** The *dataset* this delivery's source video came out of, in the shape `lib/generatedBy.ts`'s
 * `SourceDatasets` entries take: the dandiset's own API `URL`, plus the archive-relative `Path` the
 * video sat at inside it and the `BlobID` its bytes are stored as, when that is known. `SourceDatasets` means datasets in BIDS, so the entry leads with the
 * dataset and names the one asset within it as a detail, rather than the other way round.
 *
 * Null when the source names no dataset at all — a locally dropped file, or a streamed URL from
 * somewhere that is not an archive — which leaves `SourceDatasets` out rather than inventing an
 * entry for a dataset that does not exist. */
export function buildSourceDatasetEntry(api: string, source: ArchiveSource | null): SourceDatasetEntry | null {
  if (!source) return null;
  const entry: SourceDatasetEntry = { URL: `${api}/dandisets/${source.dandisetId}` };
  if (source.path) entry.Path = source.path;
  if (source.blobId) entry.BlobID = source.blobId;
  return entry;
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

/** Everything about a video/image's technical properties this app only ever has best-effort — never
 * guessed when unknown, so every field here is optional and omitted rather than invented (see
 * `videoTechnicalFields`/`imageTechnicalFields`). Every one of them is read off a real file: a
 * source's off the container it was opened from (`StreamingVideoBackend`, lib/streaming.ts), an
 * extract's off the bytes this app itself just wrote (lib/videoFormat.ts, lib/pngFormat.ts). */
export interface TechnicalDetail {
  codec?: string;
  /** The same codec as a full RFC 6381 parameter string (BEP047's `VideoCodecRFC6381`) — more
   * specific than `codec` alone, since it also carries the profile and level a decoder needs. */
  codecRFC6381?: string;
  /** FFmpeg's own `pix_fmt` naming (`"yuv420p"`, `"yuv420p10le"`, …) — BEP047's `ImagePixelFormat`. */
  pixelFormat?: string;
  /** Bits per channel of the stored pixel data — BEP047's `ImageBitDepth`. */
  bitDepth?: number;
}

/** The subset of BEP047's technical keys that make sense for a video (or the derivatives entity
 * that produced one) — omitted entirely for a still frame, whose sidecar uses
 * {@link imageTechnicalFields} instead. */
export interface VideoTechnicalFields {
  RecordingDuration: number;
  VideoFrameRate: number;
  VideoFrameCount: number;
  ImageWidth: number;
  ImageHeight: number;
  ImagePixelFormat?: string;
  ImageBitDepth?: number;
  /** Omitted rather than guessed when this app never pinned it down — a stream copy of a source
   * whose own codec was never probed, say. */
  VideoCodec?: string;
  VideoCodecRFC6381?: string;
}

export function videoTechnicalFields(
  fps: number,
  width: number,
  height: number,
  numFrames: number,
  detail: TechnicalDetail = {},
): VideoTechnicalFields {
  return {
    RecordingDuration: fps > 0 ? numFrames / fps : 0,
    VideoFrameRate: fps,
    VideoFrameCount: numFrames,
    ImageWidth: width,
    ImageHeight: height,
    ...(detail.pixelFormat ? { ImagePixelFormat: detail.pixelFormat } : {}),
    ...(detail.bitDepth ? { ImageBitDepth: detail.bitDepth } : {}),
    ...(detail.codec ? { VideoCodec: detail.codec } : {}),
    ...(detail.codecRFC6381 ? { VideoCodecRFC6381: detail.codecRFC6381 } : {}),
  };
}

export interface ImageTechnicalFields {
  ImageWidth: number;
  ImageHeight: number;
  ImagePixelFormat?: string;
  ImageBitDepth?: number;
}

export function imageTechnicalFields(width: number, height: number, detail: TechnicalDetail = {}): ImageTechnicalFields {
  return {
    ImageWidth: width,
    ImageHeight: height,
    ...(detail.pixelFormat ? { ImagePixelFormat: detail.pixelFormat } : {}),
    ...(detail.bitDepth ? { ImageBitDepth: detail.bitDepth } : {}),
  };
}

/** A blob's own digests, in the shape a sidecar's `Checksum` field takes — see `checksumField`. Named
 * a sidecar's `Checksum` names all three of a file's digests, not just the one the archive uses. */
export interface FileDigest {
  md5: string;
  sha256: string;
  dandiEtag: string;
}

/** One entry of a sidecar's own `Checksum` list — two free-form keys, not a BEP047 or BEP028 field
 * (neither proposal defines one), following the SPDX checksum shape (`ChecksumAlgorithm`,
 * `ChecksumValue`) since that is a widely recognized way to write "this algorithm produced this
 * digest" without inventing a shape of this app's own. `spdx:checksumAlgorithm_sha256` and
 * `spdx:checksumAlgorithm_md5` name plain whole-file digests (lib/etag.ts's `computeSha256`/
 * `computeMd5`), SHA-256 first as the one most tooling outside the archive reaches for;
 * `dandi:dandi-etag` is not itself an SPDX algorithm, but is the identifier the archive addresses the
 * blob by, so it travels here as its own entry rather than being left out for not fitting SPDX's own
 * enum. */
export interface SidecarChecksum {
  ChecksumAlgorithm: string;
  ChecksumValue: string;
}

function checksumField(digest: FileDigest): SidecarChecksum[] {
  return [
    { ChecksumAlgorithm: "spdx:checksumAlgorithm_sha256", ChecksumValue: digest.sha256 },
    { ChecksumAlgorithm: "spdx:checksumAlgorithm_md5", ChecksumValue: digest.md5 },
    { ChecksumAlgorithm: "dandi:dandi-etag", ChecksumValue: digest.dandiEtag },
  ];
}

/** The full sidecar for the delivery's primary output — the extracted clip or frame itself. Standard
 * BEP047 keys — no nested, app-specific record alongside them (see this module's own header
 * comment), and no `GeneratedBy` (BEP028) either: that already lives in `dataset_description.json`
 * (see lib/generatedBy.ts/lib/datasetDescription.ts), which is where BEP028 defines it, so repeating
 * it per-file would only be redundant. `digest` is this same file's own — always given, since the
 * primary output is always checksummed on its way up (see main.ts's `assembleSelection`). BEP047's
 * own technical keys (`VideoFrameRate`, `ImageWidth`, …) are written last, grouped together at the
 * end of the file rather than interleaved with everything else, so the "what is this and where did
 * it come from" keys read together first. */
export function buildBehSidecar(
  input: ProvenanceInput,
  technical: VideoTechnicalFields | ImageTechnicalFields,
  digest: FileDigest,
): Record<string, unknown> {
  return {
    Description: input.description?.trim() || null,
    Checksum: checksumField(digest),
    ...technical,
  };
}

/** A lighter sidecar for a companion file — the pose overlay, or the original source copied alongside
 * its derivative — that only needs to name what it is and point back at whatever it came from, rather
 * than repeat the primary sidecar's whole record a second time. No `GeneratedBy` here either, for the
 * same reason `buildBehSidecar` above has none.
 *
 * Only BEP047 media companions get one at all. A loaded pose file (`.slp`, `.nwb`) travels beside the
 * extract with no sidecar: both formats describe themselves from the inside, so a companion `.json`
 * would restate what opening the file already says (see main.ts's deliverAnnotationFile). */
export interface CompanionSidecarInput {
  description: string;
  technical: VideoTechnicalFields | ImageTechnicalFields;
  /** The asset path(s) this file was derived or copied from, relative to the dataset root; empty for
   * the untouched source video itself, which has no upstream to name. */
  sources: string[];
  /** This file's own digest — always real, since every companion written is a video or image asset
   * `checksumField` gives an identity to. */
  checksum: FileDigest;
}

export function buildCompanionSidecar(input: CompanionSidecarInput): Record<string, unknown> {
  const sidecar: Record<string, unknown> = { Description: input.description };
  // Omitted rather than written empty: an untouched source video has no upstream to name, and an
  // absent `Sources` says that more plainly than one that names nothing.
  if (input.sources.length) sidecar.Sources = input.sources;
  sidecar.Checksum = checksumField(input.checksum);
  // BEP047's own technical keys, grouped together last — see buildBehSidecar's own comment on why.
  Object.assign(sidecar, input.technical);
  return sidecar;
}
