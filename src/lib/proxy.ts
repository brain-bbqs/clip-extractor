// A lighter copy of the marked range, for a player that cannot keep up with the recording itself.
//
// Reading ahead (see main.ts's transport section) takes the decoder's worst case out of playback,
// but it cannot make a decoder faster than it is. A phone handed a 1080p recording at 60 frames a
// second can be short of decoding it in real time however cleverly it is asked, and a loop pays that
// again on every pass once the range outgrows the decoded-frame cache. The answer here is the one an
// editing suite gives: a proxy. The range is decoded once, re-encoded small and with frequent key
// frames, and the player loops over that copy instead. The copy is for playback only — the frame on
// screen when playback stops, and everything extracted, is the recording's own.
//
// Which player needs one is not decided from the device but by watching it: the meter below counts
// the frames drawn against the frames due, and the copy is only made once playback has demonstrably
// fallen behind. A machine that keeps up never makes one and plays the recording as it is.

/** The longest range a copy is made for, in seconds of video. Making one means decoding the range
 * in full and encoding it again, which on the phone that needs it runs well under real time; past
 * this the wait would outlast the interest in the loop. */
export const PROXY_MAX_SECONDS = 20;

/** The most pixels along the copy's longer side. Enough to follow motion on a phone's screen, and a
 * ninth of a 1080p frame's pixels to decode, to turn into a bitmap and to keep. */
export const PROXY_MAX_DIMENSION = 640;

/** How often the copy carries a key frame, in seconds. Frequent on purpose: every read-ahead window
 * starts decoding at the key frame before it, so a sparse copy would hand back the wait the copy
 * exists to remove. */
export const PROXY_KEYFRAME_SECONDS = 0.5;

/** Memory the copy's decoded frames may take between them. Smaller than the recording's own budget
 * (main.ts's FRAME_CACHE_BYTES), which stays allocated beside it for scrubbing: a device that needs
 * a copy is not one with memory to spare. At the copy's size this still holds several seconds. */
export const PROXY_CACHE_BYTES = 64 * 1024 * 1024;

/** How long playback is watched at a stretch before it is judged, in milliseconds. */
export const LAG_WINDOW_MS = 1000;
/** The share of the frames due in a window that may go undrawn before that window counts as
 * fallen behind. A frame or two dropped to a busy moment is not a decoder that cannot keep up. */
export const LAG_TOLERATED = 1 / 3;
/** How many windows in a row have to fall behind. Two: one can be a tab switch or a collector pause. */
export const LAG_WINDOWS = 2;

/** Whether a range of `frames` frames at `fps` is short enough to be worth a copy. */
export function proxyWorthwhile(frames: number, fps: number): boolean {
  if (!(frames > 0) || !(fps > 0)) return false;
  return frames / fps <= PROXY_MAX_SECONDS;
}

/** The copy's dimensions for a picture of `width`x`height`: scaled to fit `maxDimension` along its
 * longer side with the aspect kept, never scaled up, and both even, since H.264 subsamples chroma
 * in pairs and an encoder handed an odd edge either refuses or pads. */
export function proxyDimensions(width: number, height: number, maxDimension: number): { width: number; height: number } {
  const longer = Math.max(width, height);
  const scale = longer > maxDimension ? maxDimension / longer : 1;
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Counts the frames drawn against the frames due, and says when playback has fallen behind. */
export class LagMeter {
  private start = 0;
  private drawn = 0;
  private behind = 0;

  constructor(
    private readonly windowMs: number,
    private readonly tolerated: number,
    private readonly windows: number,
  ) {}

  /** Starts watching from `now`, forgetting whatever came before. */
  reset(now: number): void {
    this.start = now;
    this.drawn = 0;
    this.behind = 0;
  }

  /** A frame reached the screen. */
  drew(): void {
    this.drawn++;
  }

  /** Called as time passes with `rate`, the frames due per second. True once enough windows in a
   * row have each had more than the tolerated share of their frames go undrawn; a window that keeps
   * up starts the count over. */
  check(now: number, rate: number): boolean {
    const elapsed = now - this.start;
    if (elapsed < this.windowMs) return false;
    const due = (rate * elapsed) / 1000;
    const drawn = this.drawn;
    this.start = now;
    this.drawn = 0;
    // Too little due to judge by — a rate of nothing, or a window barely begun.
    if (due < 1) return false;
    const undrawn = 1 - Math.min(drawn, due) / due;
    this.behind = undrawn > this.tolerated ? this.behind + 1 : 0;
    return this.behind >= this.windows;
  }
}
