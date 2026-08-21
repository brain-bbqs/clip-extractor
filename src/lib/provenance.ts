import type { SourceDatasetEntry } from "./generatedBy";

// A small sidecar written beside every upload, so a clip found later in the archive can be traced
// back to which video it came from and what the person extracting it wrote about it.
//
// This used to also carry a free-standing, ad hoc "clip-extractor" provenance record (who uploaded
// it, exactly which frames, what was blurred, …) nested under its own key. That record is gone —
// proper W3C PROV records are a later PR's job, and the ad hoc shape here was never going to be how
// that gets done — so this module is left with just what the sidecar's standards-facing keys
// (`Description`, `Checksum`, `GeneratedBy`, `SourceDatasets`) actually need.

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

/** What a sidecar's own builders need to know about this delivery — just the description typed for
 * it and the source video's own identity, now that no free-standing provenance record travels with
 * it (see this module's own header comment). */
export interface ProvenanceInput {
  /** Free text from the description field; trimmed here, and blank counts as none. */
  description: string | null;
  source: {
    /**
     * Base name only, never a path: a browser exposes `File.name` and nothing else for a picked or
     * dropped file (`input.value` is deliberately fabricated as `C:\fakepath\…`, and
     * `webkitRelativePath` is populated only for directory pickers, which this app does not use). So
     * the checksum below — not the name — is what identifies the source video again later.
     */
    filename: string;
    /** The URL a streamed source came from, or null for a local file. */
    url: string | null;
    /** The original's dandi-etag, recorded whether or not the original itself was uploaded. */
    checksum: string | null;
  };
}

function checksum(value: string | null): ProvenanceChecksum | null {
  return value ? { algorithm: "dandi:dandi-etag", value } : null;
}

/** The source video, in the shape `lib/generatedBy.ts`'s `SourceDatasets` entries take — or null for
 * a locally dropped file, which has no dereferencable `URL` and so nothing `SourceDatasets` names any
 * differently than the sidecar's own `Description`/`Checksum` already do; a bare `Filename`/`Checksum`
 * pair would not actually identify a *source dataset* the way BIDS means the field, just repeat what
 * is already on the file itself. Only a video opened from a real address (streamed from the archive,
 * say) gets an entry — that address is the one thing worth recording here that is not already known
 * from the delivery's own files. */
export function buildSourceDatasetEntry(input: ProvenanceInput): SourceDatasetEntry | null {
  if (!input.source.url) return null;
  const entry: SourceDatasetEntry = { URL: input.source.url };
  if (input.source.filename) entry.Filename = input.source.filename;
  const c = checksum(input.source.checksum);
  if (c) entry.Checksum = c;
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
 * `videoTechnicalFields`/`imageTechnicalFields`). `codec`/`codecRFC6381` come off
 * `StreamingVideoBackend`'s own inspection of a real container (see lib/streaming.ts); ffmpeg.wasm's
 * own h264 output does not carry a probed pixel format the same way, so `pixelFormat`/`bitDepth` are
 * only ever known for a source read through that backend, not for what this app itself encoded. */
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
 * apart from `ProvenanceChecksum` (this app's own `{algorithm, value}` shape, used elsewhere in this
 * file) since a sidecar's `Checksum` names both a plain MD5 and the dandi-etag, not just one. */
export interface FileDigest {
  md5: string;
  dandiEtag: string;
}

/** One entry of a sidecar's own `Checksum` list — two free-form keys, not a BEP047 or BEP028 field
 * (neither proposal defines one), following the SPDX checksum shape (`ChecksumAlgorithm`,
 * `ChecksumValue`) since that is a widely recognized way to write "this algorithm produced this
 * digest" without inventing a shape of this app's own. `spdx:checksumAlgorithm_md5` names a plain
 * whole-file MD5 (lib/etag.ts's `computeMd5`); `dandi:dandi-etag` is not itself an SPDX algorithm, but
 * is the identifier the archive addresses the blob by, so it travels here as its own entry rather than
 * being left out for not fitting SPDX's own enum. */
export interface SidecarChecksum {
  ChecksumAlgorithm: string;
  ChecksumValue: string;
}

function checksumField(digest: FileDigest): SidecarChecksum[] {
  return [
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

/** A lighter sidecar for a companion file — the pose overlay, the original source copied alongside
 * its derivative, or a loaded `.slp` — that only needs to name what it is and point back at whatever
 * it came from, rather than repeat the primary sidecar's whole record a second time. No `GeneratedBy`
 * here either, for the same reason `buildBehSidecar` above has none. */
export interface CompanionSidecarInput {
  description: string;
  /** Omitted for a file BEP047 has no technical vocabulary for at all — a `.slp`, say — rather than
   * for anything with real dimensions or a frame rate to report. */
  technical?: VideoTechnicalFields | ImageTechnicalFields;
  /** The asset path(s) this file was derived or copied from, relative to the dataset root; empty for
   * the untouched source video itself, which has no upstream to name. */
  sources: string[];
  /** This file's own digest, or null for one BEP047 gives no `Checksum`-worthy identity to — a `.slp`,
   * which is not itself a video/image asset (see `checksumField`). Video/image companions (the pose
   * overlay, the copied-along original) always pass their own real digest. */
  checksum: FileDigest | null;
}

export function buildCompanionSidecar(input: CompanionSidecarInput): Record<string, unknown> {
  const sidecar: Record<string, unknown> = { Description: input.description };
  // Omitted rather than written empty: an untouched source video has no upstream to name, and an
  // absent `Sources` says that more plainly than one that names nothing.
  if (input.sources.length) sidecar.Sources = input.sources;
  if (input.checksum) sidecar.Checksum = checksumField(input.checksum);
  // BEP047's own technical keys, grouped together last — see buildBehSidecar's own comment on why.
  Object.assign(sidecar, input.technical);
  return sidecar;
}
