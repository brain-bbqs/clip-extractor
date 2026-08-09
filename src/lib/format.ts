// Small display-formatting helpers shared by the log, timeline, and result panels.

/** Formats a frame index as `mm:ss.ss` given the source fps, or the bare frame number if fps is 0. */
export function fmtTime(frame: number, fps: number): string {
  if (!fps) return String(frame);
  const s = frame / fps;
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toFixed(2).padStart(5, "0")}`;
}

/** Formats a byte count as a human-readable B/KB/MB string, or "—" for null/undefined. */
export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/** Two-letter avatar initials from a full name, or "??" when there isn't a first and last name. */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "??";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Formats a Blob's size via {@link bytes}. */
export function blobSize(b: Blob): string {
  return bytes(b.size);
}
