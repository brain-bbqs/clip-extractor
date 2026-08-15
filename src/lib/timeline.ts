import { rulerStep } from "./format";

// The stretch of a recording the trim track covers, and the gradations laid out across it.
//
// Up to a couple of hours the track covers the whole video, which is what it has always done. Past
// that it covers a fixed window instead, moved by the overview slider underneath it: a day-long
// recording across one track puts a minute and a half of video under every pixel, which is a
// control that cannot land within a thousand frames of anything. A fixed window is the one shape
// whose precision does not depend on how long the recording is — a hundred-hour file trims exactly
// as finely as a three-hour one, because the track always spans the same two hours.

/** How much of the recording the track covers either side of the overview slider's position, in
 * seconds. Narrow enough that a snippet can be trimmed against it, wide enough to hold a bout and
 * its surroundings; the choices below cover the rest, and the pick is remembered. */
export const DEFAULT_WINDOW_HALF_SECONDS = 1800;

/** The half-widths offered beside the transport, narrowest first. All well under an hour: a wider
 * window than this is a track nobody can trim against, which is the problem the window solves. */
export const WINDOW_HALF_CHOICES = [300, 900, 1800] as const;

/** A stored or typed half-width, held to one of the offered choices. Anything unrecognised falls
 * back to the default rather than leaving the track at a width nothing on screen can undo. */
export function windowHalfSeconds(seconds: unknown): number {
  return WINDOW_HALF_CHOICES.find((choice) => choice === seconds) ?? DEFAULT_WINDOW_HALF_SECONDS;
}

/** The stretch of frames the trim track covers: `len` frames starting at `start`. */
export interface TimelineView {
  start: number;
  len: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** A half-width in frames, for a source running at `fps`. */
export function windowHalfFrames(halfSeconds: number, fps: number): number {
  return Math.max(1, Math.round(halfSeconds * (fps > 0 ? fps : 30)));
}

/** Whether the overview slider is worth showing: only once the recording is longer than the window
 * the slider moves. Below that the window is the whole video and the slider has nowhere to slide,
 * so the two-hour threshold is the geometry rather than a separate rule. */
export function usesWindow(totalFrames: number, halfFrames: number): boolean {
  return totalFrames > halfFrames * 2;
}

/** Whether the width control is worth offering: true once the narrowest width on offer would put a
 * window inside the recording. Deliberately not tied to the width currently picked, or choosing one
 * wide enough to cover the whole video would take the control that chose it off the screen. */
export function offersWindowChoice(totalFrames: number, fps: number): boolean {
  return usesWindow(totalFrames, windowHalfFrames(WINDOW_HALF_CHOICES[0], fps));
}

/** The window centred on `center`, clamped inside the recording. Never resized to fit: at either
 * end the window stops while the centre keeps going, the way a page stops scrolling at its end —
 * shrinking it instead would change the scale of the track under a drag. */
export function windowFor(totalFrames: number, center: number, halfFrames: number): TimelineView {
  const len = Math.min(Math.max(1, totalFrames), halfFrames * 2);
  return { start: Math.round(clamp(center - len / 2, 0, Math.max(0, totalFrames - len))), len };
}

/** Where a frame sits across the window: 0 at its left edge, 1 at its right. Deliberately not
 * clamped — a frame the window does not cover reads outside 0..1, which is what tells a marker to
 * flatten against the edge it left through rather than claim a position on the ruler. */
export function fractionOf(view: TimelineView, frame: number): number {
  return (frame - view.start) / Math.max(1, view.len - 1);
}

/** The frame a fraction across the window lands on, clamped to the video. */
export function frameAt(view: TimelineView, fraction: number, totalFrames: number): number {
  const frame = Math.round(view.start + clamp(fraction, 0, 1) * (view.len - 1));
  return clamp(frame, 0, Math.max(0, totalFrames - 1));
}

/** One gradation on the trim track's ruler. */
export interface RulerMark {
  frame: number;
  seconds: number;
  major: boolean;
}

/** The gradations across a window, at the step {@link rulerStep} picks for its duration.
 *
 * Counted from the start of the recording rather than from the window's left edge, so they land on
 * round absolute times: a window over the fifteenth hour is labelled 14:20 and 14:40 rather than
 * 0:20 and 0:40, which would name a position in the window instead of a moment in the video. */
export function rulerMarks(view: TimelineView, fps: number): RulerMark[] {
  if (view.len <= 1 || fps <= 0) return [];
  // Both bounds are the window's last frame rather than one past it, so a window covering a whole
  // video divides it exactly as the timeline always has.
  const last = view.start + view.len - 1;
  const { minor } = rulerStep((view.len - 1) / fps);
  const marks: RulerMark[] = [];
  for (let step = Math.ceil(view.start / fps / minor); step * minor * fps <= last; step++) {
    marks.push({ frame: Math.round(step * minor * fps), seconds: step * minor, major: step % 5 === 0 });
  }
  return marks;
}

/** One gradation on the overview slider. */
export interface HourMark {
  frame: number;
  hour: number;
  labelled: boolean;
}

/** Hour gradations across the whole recording, thinned to whatever the bar is wide enough to hold.
 *
 * Landmarks rather than divisions: "go to hour 14" stays something to aim at, without quantising
 * the window to hour boundaries, which would split a clip that straddles 14:59. */
export function hourMarks(totalFrames: number, fps: number, widthPx: number): HourMark[] {
  if (totalFrames <= 0 || fps <= 0 || widthPx <= 0) return [];
  const perHour = 3600 * fps;
  const pxPerHour = widthPx / (totalFrames / perHour);
  if (!Number.isFinite(pxPerHour) || pxPerHour <= 0) return [];
  const tickEvery = pxPerHour >= 7 ? 1 : Math.ceil(7 / pxPerHour);
  const labelEvery = Math.max(tickEvery, Math.ceil(54 / pxPerHour));
  const marks: HourMark[] = [];
  for (let hour = 0; hour * perHour <= totalFrames; hour += tickEvery) {
    marks.push({ frame: Math.round(hour * perHour), hour, labelled: hour % labelEvery === 0 });
  }
  return marks;
}
