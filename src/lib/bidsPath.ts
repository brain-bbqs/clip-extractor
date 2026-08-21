// The BEP047 layout this app writes into: an extracted behavioral recording lands under
// sub-<label>/[ses-<label>/]beh/, once as a derivative (derivatives/clip-extractor/) and, when the
// source travels along too, once more under sourcedata/rawbids/ — see
// https://github.com/bids-standard/bids-specification/pull/2231 ("BEP047: Audio/video recordings
// for behavioral experiments") for the entity vocabulary (`sub`, `ses`, `recording`, and the
// `_audio`/`_video`/`_audiovideo`/`_image` suffixes) this module builds names out of.
//
// `sourcedata/` itself is not validated against BIDS naming at all — the spec explicitly leaves it
// free-form — but `rawbids/` underneath it is deliberately built as a complete, independently valid
// `DatasetType: "raw"` BIDS dataset of its own (its own `dataset_description.json`, entity-named
// files throughout), so that running a validator directly on `sourcedata/rawbids/` — not just on the
// dandiset as a whole — passes. That is the point of the name: the *raw*, *BIDS*-shaped copy of what
// this app read the selection out of, sitting in the place `sourcedata/` is for.
//
// BEP047 has no entity for "which delivery is this" — the closest fits (`run`, `split`) mean
// something else — so every delivery's derivatives carry a disambiguating entity of their own, of one
// of two forms depending on whether the subject is a real one. It marks both the *directory* those
// files land in, one level below `beh/`, and each filename inside it: the directory is what makes a
// listing of `beh/` read as one group per delivery, and the filename repeating it is what keeps every
// file self-describing once it is copied or downloaded somewhere its directory does not follow.
//
//   - A known subject (the source video's own path named one) means its `sourcedata` copy is the
//     one true copy of that recording — re-delivering it is expected to overwrite, not duplicate, so
//     `sourcedata` gets no disambiguator at all (see `sourcedataOriginalFilename`, entity-shaped like
//     everything else but with nothing appended to distinguish one delivery's copy from another's).
//     `derivatives`, though, still needs one: two runs of clip-extractor over the same subject/session
//     produce two different clips, so those get their own `date-<label>_time-<label>/` directory —
//     separate entities, the same spelling the pre-BIDS directory layout used.
//   - `sub-unknown` (the source names no subject at all — a video dropped straight from disk) means
//     there is nothing else tying two such deliveries apart in `derivatives`, so that tree keeps the
//     compact `recording-<label>/` directory instead. `sourcedata` stays undisambiguated even here:
//     nothing identifies one locally dropped file from another either, so it is not a case this app
//     tries to tell apart at all — same overwrite-not-duplicate treatment as the known-subject case.
//
// A saved bundle's own filename carries none of this — no subject, no stamp, nothing BIDS defines.
// It is a download rather than a file inside the tree it holds, and stops existing the moment it is
// unpacked, so it is named for the dandiset it belongs to instead (see lib/extract.ts's
// `bundleFileName`).
//
// `desc-<label>` — the entity BIDS derivatives already define for distinguishing outputs of the
// same underlying recording — marks the pose-overlay rendering (`desc-overlay`), the one thing
// BEP047's own vocabulary has no entity for. The plain extracted clip carries no `desc-` of its own:
// it is the delivery's primary output, so there is nothing it needs setting apart from.

import { sanitizeSegment } from "./sanitize";

/** Every asset this app writes into a dandiset's derivatives sits under this pipeline name. */
export const DERIVATIVES_PIPELINE = "clip-extractor";

/** A BIDS entity *label* is `[0-9a-zA-Z]+` — no punctuation at all, unlike an ordinary path
 * segment (see lib/sanitize.ts's `sanitizeSegment`, which keeps `._+-`). Accents fold to their base
 * letter first, so "café" reads as "cafe" rather than losing the character outright. */
export function bidsLabel(value: string, fallback: string): string {
  const collapsed = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "");
  return collapsed || fallback;
}

export interface BehEntities {
  sub: string;
  ses: string | null;
  /** Whether `sub` (and so `ses`) came from a real archive path, rather than the `sub-unknown`
   * fallback. Decides which of `recording`/`date`+`time` `behFilename` uses to disambiguate this
   * delivery from any other of the same subject/session — see the module comment above. */
  known: boolean;
  /** The compact digits-only instant stamp, used only when `!known`. */
  recording: string;
  /** This delivery's date, used only when `known` (paired with `time` in place of `recording`). */
  date: string;
  /** This delivery's time, used only when `known`. */
  time: string;
}

/** Parses `sub-<label>[/ses-<label>]` off the front of an archive-relative path, e.g. `sub-1/mice.mp4`
 * or `sub-01/ses-02/beh/whatever.mp4`. Both fields are null when the path does not start that way —
 * a locally dropped file or an arbitrary streamed URL, neither of which the archive has a path for. */
export function parseSourceSubjectSession(sourcePath: string | null): { sub: string | null; ses: string | null } {
  if (!sourcePath) return { sub: null, ses: null };
  const segments = sourcePath.split("/");
  const subMatch = /^sub-([A-Za-z0-9]+)$/.exec(segments[0] ?? "");
  if (!subMatch) return { sub: null, ses: null };
  const sesMatch = /^ses-([A-Za-z0-9]+)$/.exec(segments[1] ?? "");
  return { sub: subMatch[1], ses: sesMatch ? sesMatch[1] : null };
}

/** A compact, sortable `recording-<label>` value: this delivery's own instant, digits only (no `-`,
 * `:`, `.` or `Z`, none of which a BIDS label may hold). The exact instant, timezone designator
 * included, is still recorded in the sidecar's `created_at`. */
export function recordingLabel(now: Date): string {
  return now.toISOString().replace(/[^0-9]/g, "");
}

/** `YYYYMMDD`, UTC — `toISOString` is fixed-width, so this slice is stable. */
export function dateLabel(now: Date): string {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

/** `HHMMSS`, UTC. */
export function timeLabel(now: Date): string {
  return now.toISOString().slice(11, 19).replace(/:/g, "");
}

/** The subject/session/delivery entities every file of one delivery shares, derived from wherever
 * the source video's own path names a subject — falling back to `sub-unknown` so the tree this app
 * writes is always well-formed even for a video dropped straight from disk. */
export function behEntities(now: Date, sourcePath: string | null): BehEntities {
  const parsed = parseSourceSubjectSession(sourcePath);
  return {
    sub: parsed.sub ? bidsLabel(parsed.sub, "unknown") : "unknown",
    ses: parsed.ses ? bidsLabel(parsed.ses, "") || null : null,
    known: parsed.sub !== null,
    recording: recordingLabel(now),
    date: dateLabel(now),
    time: timeLabel(now),
  };
}

function subjectSessionSegments(e: BehEntities): string[] {
  return e.ses ? [`sub-${e.sub}`, `ses-${e.ses}`] : [`sub-${e.sub}`];
}

/** Every asset this app writes into `sourcedata/` sits under this raw-BIDS-copy pipeline name. */
export const SOURCEDATA_RAWBIDS = "rawbids";

/** Where the original source content sits, mirroring the dataset's own subject/session layout —
 * `sourcedata/rawbids/sub-<label>/[ses-<label>/]beh`. */
export function sourcedataDirectory(e: BehEntities): string {
  return ["sourcedata", SOURCEDATA_RAWBIDS, ...subjectSessionSegments(e), "beh"].join("/");
}

/** The original source video's own name under `sourcedata/rawbids/` — BEP047 entity-shaped like
 * everything else this app writes, but with no disambiguating entity at all: re-delivering the same
 * subject/session's source is expected to overwrite this copy, not duplicate it (see this module's
 * own header comment) — and that holds for the `sub-unknown` fallback too, not just a known
 * subject/session: nothing else identifies one locally dropped file from another either, so this is
 * not a case `sourcedata` tries to disambiguate at all. Keeps the original file's own extension —
 * BEP047 says nothing about which container a `_video` suffix must sit in. */
export function sourcedataOriginalFilename(e: BehEntities, originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "mp4";
  return `${subjectSessionSegments(e).join("_")}_video.${ext}`;
}

/** Where this app's own output sits —
 * `derivatives/clip-extractor/sub-<label>/[ses-<label>/]beh/<date-<label>_time-<label>|recording-<label>>`
 * — every file one delivery writes lands in this one directory, named for the disambiguating entity
 * that tells one delivery's files apart from another's own (see this module's header comment and
 * `disambiguatorEntities`), so a listing of `beh/` reads as one subdirectory per delivery. */
export function derivativesDirectory(e: BehEntities): string {
  return ["derivatives", DERIVATIVES_PIPELINE, ...subjectSessionSegments(e), "beh", disambiguatorEntities(e).join("_")].join("/");
}

export interface BehFilenameParts {
  /** BIDS derivatives' own entity for "which output, of the same recording, is this" — `overlay`
   * for the pose-drawn rendering; omitted for the plain extracted clip, which is the delivery's
   * primary output and so needs nothing to set it apart from itself. */
  desc?: string;
  /** What the file holds: BEP047's `video`/`audio`/`audiovideo`/`image`, or (for content BEP047
   * has no suffix for, like a SLEAP `.slp`) a plain descriptive word — sourcedata is not validated
   * as strictly as the rest of a BIDS tree. */
  suffix: string;
  ext: string;
}

/** The entity that tells one delivery's files apart from another's — see this module's own header
 * comment. It names both this delivery's own directory (`derivativesDirectory`) and every filename
 * inside it: the directory is what makes a listing of `beh/` read as one group per delivery, and the
 * filename repeating it is what keeps each file self-describing once it is copied, downloaded or
 * quoted somewhere its directory no longer travels with it. */
function disambiguatorEntities(e: BehEntities): string[] {
  return e.known ? [`date-${e.date}`, `time-${e.time}`] : [`recording-${e.recording}`];
}

/** `sub-<label>[_ses-<label>]_<date-<label>_time-<label>|recording-<label>>[_desc-<label>]_<suffix>.<ext>`
 * — every file one delivery writes shares this prefix and sits together in that delivery's own
 * directory (see `derivativesDirectory`). */
export function behFilename(e: BehEntities, parts: BehFilenameParts): string {
  const bits = [...subjectSessionSegments(e), ...disambiguatorEntities(e)];
  if (parts.desc) bits.push(`desc-${parts.desc}`);
  bits.push(parts.suffix);
  return `${bits.join("_")}.${parts.ext}`;
}

/** The JSON sidecar for a BEP047 media file: same name, `.json` in place of the media extension. */
export function behSidecarName(e: BehEntities, parts: Omit<BehFilenameParts, "ext">): string {
  return behFilename(e, { ...parts, ext: "json" });
}

/** Joins a directory and an already-legal filename into an asset path, sanitizing only the
 * directory segments — the filenames above are built from BIDS labels already, so nothing in them
 * needs to change. */
export function behAssetPath(directory: string, filename: string): string {
  return directory
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => sanitizeSegment(s, "_"))
    .concat(filename)
    .join("/");
}
