// The BEP047 layout this app writes into: an extracted behavioral recording lands under
// sub-<label>/[ses-<label>/]beh/, once as a derivative (derivatives/clip-extractor/) and, when the
// source travels along too, once more as sourcedata (sourcedata/) — see
// https://github.com/bids-standard/bids-specification/pull/2231 ("BEP047: Audio/video recordings
// for behavioral experiments") for the entity vocabulary (`sub`, `ses`, `recording`, and the
// `_audio`/`_video`/`_audiovideo`/`_image` suffixes) this module builds names out of.
//
// BEP047 has no entity for "which delivery is this" — the closest fits (`run`, `split`) mean
// something else — so `recording-<label>` carries that job here: a compact, sortable stamp of the
// moment this delivery was made, the same role `date-…_time-…` played in the pre-BIDS directory
// layout, now inside the filename instead of a directory name so files for the same subject sit
// flat in one `beh/` listing the way BIDS expects.
//
// `desc-<label>` — the entity BIDS derivatives already define for distinguishing outputs of the
// same underlying recording — separates the plain extracted clip from its pose-overlay rendering,
// the one thing BEP047's own vocabulary has no entity for.

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
  /** Disambiguates this delivery from any other of the same subject/session. */
  recording: string;
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

/** The subject/session/delivery entities every file of one delivery shares, derived from wherever
 * the source video's own path names a subject — falling back to `sub-unknown` so the tree this app
 * writes is always well-formed even for a video dropped straight from disk. */
export function behEntities(now: Date, sourcePath: string | null): BehEntities {
  const parsed = parseSourceSubjectSession(sourcePath);
  return {
    sub: parsed.sub ? bidsLabel(parsed.sub, "unknown") : "unknown",
    ses: parsed.ses ? bidsLabel(parsed.ses, "") || null : null,
    recording: recordingLabel(now),
  };
}

function subjectSessionSegments(e: BehEntities): string[] {
  return e.ses ? [`sub-${e.sub}`, `ses-${e.ses}`] : [`sub-${e.sub}`];
}

/** Where the original source content sits, mirroring the dataset's own subject/session layout —
 * `sourcedata/sub-<label>/[ses-<label>/]beh`. */
export function sourcedataDirectory(e: BehEntities): string {
  return ["sourcedata", ...subjectSessionSegments(e), "beh"].join("/");
}

/** Where this app's own output sits — `derivatives/clip-extractor/sub-<label>/[ses-<label>/]beh`. */
export function derivativesDirectory(e: BehEntities): string {
  return ["derivatives", DERIVATIVES_PIPELINE, ...subjectSessionSegments(e), "beh"].join("/");
}

export interface BehFilenameParts {
  /** BIDS derivatives' own entity for "which output, of the same recording, is this" — `overlay`
   * for the pose-drawn rendering; omitted for the plain extracted clip. */
  desc?: string;
  /** What the file holds: BEP047's `video`/`audio`/`audiovideo`/`image`, or (for content BEP047
   * has no suffix for, like a SLEAP `.slp`) a plain descriptive word — sourcedata is not validated
   * as strictly as the rest of a BIDS tree. */
  suffix: string;
  ext: string;
}

/** `sub-<label>[_ses-<label>]_recording-<label>[_desc-<label>]_<suffix>.<ext>` — every file one
 * delivery writes shares this prefix, so a listing of `beh/` reads as one group per delivery. */
export function behFilename(e: BehEntities, parts: BehFilenameParts): string {
  const bits = [`sub-${e.sub}`];
  if (e.ses) bits.push(`ses-${e.ses}`);
  bits.push(`recording-${e.recording}`);
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
