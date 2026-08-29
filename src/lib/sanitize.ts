// Path/filename sanitization for archive asset paths, ported from brain-bbqs/bbqs-uploader so
// both tools derive the same asset path from the same file name.

/** Reduces one path segment to `[A-Za-z0-9._+-]`, collapsing runs and trimming punctuation ends.
 * Whitespace becomes `+`, keeping word boundaries legible in a name that cannot hold spaces; any
 * other illegal character becomes `_`. `+` also survives untouched because this app generates it
 * itself, in the BIDS-style `range-<in>+<out>` entity of an extracted snippet's name (see
 * lib/extract.ts) — replacing it would corrupt that entity. */
export function sanitizeSegment(segment: string, fallback: string): string {
  let s = segment.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/\s+/g, "+");
  s = s.replace(/[^A-Za-z0-9._+-]+/g, "_");
  s = s
    .replace(/_{2,}/g, "_")
    .replace(/\+{2,}/g, "+")
    .replace(/^[._+-]+|[._+-]+$/g, "");
  return s || fallback;
}

/**
 * Keeps a file name as it arrived — punctuation, parentheses and case all intact — removing only
 * spaces, plus whatever could escape the directory or break the path (separators, control
 * characters, leading dots). Used for the original video, which is uploaded untouched otherwise.
 *
 * Note spaces are dropped here rather than turned into `+` the way lib/extract.ts's generated names
 * do it: this name is not an entity list, so there are no word boundaries worth marking.
 */
export function verbatimFilename(originalName: string, fallback = "original"): string {
  const flattened = originalName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, "")
    .replace(/[/\\]+/g, "_")
    .replace(/^\.+/, "");
  return flattened || fallback;
}
