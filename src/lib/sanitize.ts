// Path/filename sanitization for archive asset paths, ported from brain-bbqs/bbqs-uploader so
// both tools derive the same asset path from the same file name.

/** Reduces one path segment to `[A-Za-z0-9._-]`, collapsing runs and trimming punctuation ends. */
export function sanitizeSegment(segment: string, fallback: string): string {
  let s = segment.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^A-Za-z0-9._-]+/g, "_");
  s = s.replace(/_{2,}/g, "_").replace(/^[._-]+|[._-]+$/g, "");
  return s || fallback;
}

/** Sanitizes a file name while preserving (and lower-casing) its extension. */
export function sanitizeFilename(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const hasExt = dot > 0; // a dot at index 0 is a dotfile, not an extension
  const base = hasExt ? originalName.slice(0, dot) : originalName;
  const ext = hasExt ? originalName.slice(dot).toLowerCase() : "";
  return `${sanitizeSegment(base, "file")}${ext}`;
}

/** Joins a (sanitized) directory prefix and an already-sanitized filename into an asset path. */
export function sanitizePath(prefix: string, filename: string): string {
  const segments = prefix
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => sanitizeSegment(s, "_"));
  return [...segments, filename].join("/");
}
