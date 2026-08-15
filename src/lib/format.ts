// Small display-formatting helpers shared by the log, timeline, and result panels.

/** Formats a frame index as `mm:ss.ss` given the source fps, or the bare frame number if fps is 0. */
export function fmtTime(frame: number, fps: number): string {
  if (!fps) return String(frame);
  const s = frame / fps;
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toFixed(2).padStart(5, "0")}`;
}

// Binary multiples, labelled with the shorter names — the convention every readout in this app has
// always used, kept so a size reads the same wherever it appears.
const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const TB = GB * 1024;

/**
 * Formats a byte count as a human-readable B/KB/MB/GB/TB string, or "—" for null/undefined.
 *
 * The ladder runs to terabytes because the things being measured do: an archived recording can be
 * hundreds of gigabytes, and stopping at megabytes rendered one of those as six figures of MB.
 */
export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < KB) return `${n} B`;
  if (n < MB) return `${(n / KB).toFixed(1)} KB`;
  if (n < GB) return `${(n / MB).toFixed(2)} MB`;
  if (n < TB) return `${(n / GB).toFixed(2)} GB`;
  return `${(n / TB).toFixed(2)} TB`;
}

// Gradations the timeline ruler is allowed to divide a video into, in seconds. Every one of them is
// a step someone reads at a glance; 3s or 7s marks would be arithmetic instead. The hour-scale steps
// carry a recording rather than a clip: without them the largest step available was 15 minutes, and
// an archive recording running for hours came out as hundreds of ticks under a smear of overlapping
// labels, none of them legible.
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

/** The gradation a video of `seconds` is divided by: the step landing nearest six labelled
 * divisions, and the fifth of it the minor ticks sit on. */
export function rulerStep(seconds: number): { major: number; minor: number } {
  const major = RULER_STEPS.find((step) => step >= seconds / 6) ?? RULER_STEPS[RULER_STEPS.length - 1];
  return { major, minor: major / 5 };
}

/** A gradation's time as `m:ss`, or `h:mm:ss` once there are hours to tell apart — a ten-hour mark
 * reading "600:00" is a division nobody can place at a glance. */
export function rulerLabel(seconds: number): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole - hours * 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  if (!hours) return `${minutes}:${secs}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${secs}`;
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
