import { describe, expect, it } from "vitest";
import {
  frameAt,
  fractionOf,
  hourMarks,
  rulerMarks,
  usesWindow,
  windowFor,
  windowHalfFrames,
  windowHalfSeconds,
  DEFAULT_WINDOW_HALF_SECONDS,
  WINDOW_HALF_CHOICES,
} from "../../src/lib/timeline";

const FPS = 30;
const HOUR = 3600 * FPS;
const DAY = 24 * HOUR;
// The default: half an hour either side, so the timeline covers an hour of a long recording.
const HALF = windowHalfFrames(DEFAULT_WINDOW_HALF_SECONDS, FPS);

describe("windowHalfSeconds", () => {
  it("keeps a width that is on offer", () => {
    for (const choice of WINDOW_HALF_CHOICES) expect(windowHalfSeconds(choice)).toBe(choice);
  });

  it("offers the default among them, at half an hour either side", () => {
    expect(DEFAULT_WINDOW_HALF_SECONDS).toBe(1800);
    expect(WINDOW_HALF_CHOICES).toContain(DEFAULT_WINDOW_HALF_SECONDS);
  });

  it("falls back to the default rather than leaving the track at a width nothing can undo", () => {
    // Whatever storage held: an older build's value, a hand-edited one, or nothing at all.
    expect(windowHalfSeconds(12345)).toBe(DEFAULT_WINDOW_HALF_SECONDS);
    expect(windowHalfSeconds(undefined)).toBe(DEFAULT_WINDOW_HALF_SECONDS);
    expect(windowHalfSeconds("1800")).toBe(DEFAULT_WINDOW_HALF_SECONDS);
    expect(windowHalfSeconds(Number.NaN)).toBe(DEFAULT_WINDOW_HALF_SECONDS);
  });
});

describe("windowHalfFrames", () => {
  it("converts a half-width to frames at the source's rate", () => {
    expect(windowHalfFrames(1800, 30)).toBe(1800 * 30);
    expect(windowHalfFrames(1800, 59.94)).toBe(Math.round(1800 * 59.94));
  });

  it("falls back to 30 fps rather than returning a window of nothing", () => {
    expect(windowHalfFrames(1800, 0)).toBe(1800 * 30);
    expect(windowHalfFrames(1800, -1)).toBe(1800 * 30);
  });
});

describe("usesWindow", () => {
  it("leaves a recording no longer than the window on the timeline it has always had", () => {
    expect(usesWindow(30 * 60 * FPS, HALF)).toBe(false);
    expect(usesWindow(2 * HALF, HALF)).toBe(false); // exactly the window: nowhere to slide
  });

  it("takes over once the recording is longer than the window", () => {
    expect(usesWindow(2 * HALF + 1, HALF)).toBe(true);
    expect(usesWindow(DAY, HALF)).toBe(true);
  });

  it("puts that threshold at an hour of recording, for the default width", () => {
    expect(2 * HALF).toBe(HOUR);
  });
});

describe("windowFor", () => {
  it("centres the window on the position it is given", () => {
    expect(windowFor(DAY, 14 * HOUR, HALF)).toEqual({ start: 14 * HOUR - HALF, len: 2 * HALF });
  });

  it("keeps its size at either end rather than shrinking to fit", () => {
    // The centre runs out of room before the recording does; the window stops, at its full width.
    expect(windowFor(DAY, 0, HALF)).toEqual({ start: 0, len: 2 * HALF });
    expect(windowFor(DAY, DAY - 1, HALF)).toEqual({ start: DAY - 2 * HALF, len: 2 * HALF });
  });

  it("covers the whole video when the video is shorter than the window", () => {
    const short = 20 * 60 * FPS;
    expect(windowFor(short, short / 2, HALF)).toEqual({ start: 0, len: short });
  });

  it("survives a video with no frames rather than returning a negative span", () => {
    expect(windowFor(0, 0, HALF)).toEqual({ start: 0, len: 1 });
  });
});

describe("fractionOf", () => {
  const at = windowFor(DAY, 14 * HOUR, HALF);

  it("places a frame across the window", () => {
    expect(fractionOf(at, 14 * HOUR - HALF)).toBe(0);
    expect(fractionOf(at, 14 * HOUR)).toBeCloseTo(0.5, 5);
    expect(fractionOf(at, 14 * HOUR + HALF - 1)).toBeCloseTo(1, 5);
  });

  it("runs outside 0..1 for a frame the window does not cover, so a marker knows it is off", () => {
    expect(fractionOf(at, 0)).toBeLessThan(0);
    expect(fractionOf(at, DAY - 1)).toBeGreaterThan(1);
  });
});

describe("frameAt", () => {
  const at = windowFor(DAY, 14 * HOUR, HALF);

  it("reads a position across the window back as a frame", () => {
    expect(frameAt(at, 0, DAY)).toBe(14 * HOUR - HALF);
    expect(frameAt(at, 0.5, DAY)).toBe(14 * HOUR);
  });

  it("round-trips with fractionOf", () => {
    const frame = at.start + 12345;
    expect(frameAt(at, fractionOf(at, frame), DAY)).toBe(frame);
  });

  it("clamps a position off either end of the track to the window", () => {
    expect(frameAt(at, -2, DAY)).toBe(at.start);
    expect(frameAt(at, 4, DAY)).toBe(at.start + at.len - 1);
  });

  it("never reads past the last frame of the video", () => {
    const at0 = windowFor(DAY, 0, HALF);
    expect(frameAt(at0, 1, 60)).toBe(59);
  });
});

describe("rulerMarks", () => {
  it("lands gradations on round absolute times, not on the window's left edge", () => {
    // A window over the fourteenth hour is labelled 14:00 and 14:10, not 0:00 and 0:10: the
    // gradations name a moment in the recording rather than a position in the window. The centre is
    // deliberately off a round time, which is exactly when counting from the window's edge shows.
    const marks = rulerMarks(windowFor(DAY, 14 * HOUR + 733, HALF), FPS);
    const majors = marks.filter((m) => m.major).map((m) => m.seconds);
    expect(majors.every((s) => s % 600 === 0)).toBe(true);
    expect(majors).toContain(14 * 3600);
  });

  it("keeps every gradation inside the window", () => {
    const at = windowFor(DAY, 9 * HOUR, HALF);
    const marks = rulerMarks(at, FPS);
    expect(marks.length).toBeGreaterThan(0);
    for (const { frame } of marks) {
      expect(frame).toBeGreaterThanOrEqual(at.start);
      expect(frame).toBeLessThan(at.start + at.len);
    }
  });

  it("divides a whole short video the way it always did", () => {
    const marks = rulerMarks({ start: 0, len: 30 * FPS }, FPS);
    expect(marks[0]).toEqual({ frame: 0, seconds: 0, major: true });
    expect(marks.filter((m) => m.major).map((m) => m.seconds)).toEqual([0, 5, 10, 15, 20, 25]);
  });

  it("returns nothing rather than dividing by zero for an empty or rate-less source", () => {
    expect(rulerMarks({ start: 0, len: 1 }, FPS)).toEqual([]);
    expect(rulerMarks({ start: 0, len: DAY }, 0)).toEqual([]);
  });
});

describe("hourMarks", () => {
  it("marks every hour of a day-long recording, labelling as many as the bar can hold", () => {
    const marks = hourMarks(DAY, FPS, 900);
    expect(marks).toHaveLength(25); // 0:00 through 24:00
    expect(marks.every((m) => m.hour * HOUR === m.frame)).toBe(true);
    const labelled = marks.filter((m) => m.labelled).map((m) => m.hour);
    expect(labelled[0]).toBe(0);
    // ~36 px per hour, so labels come every other hour rather than on top of each other.
    expect(labelled).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  });

  it("thins the ticks themselves once hourly ones would not fit", () => {
    // 200 hours across 900 px is 4.5 px an hour, so the ticks go every other hour to stay apart.
    const width = 900;
    const total = 200 * HOUR;
    const marks = hourMarks(total, FPS, width);
    const gapPx = (marks[1].frame - marks[0].frame) * (width / total);
    expect(gapPx).toBeGreaterThanOrEqual(7);
    expect(marks.filter((m) => m.labelled).length).toBeLessThan(20);
  });

  it("returns nothing for a bar that has not been laid out yet", () => {
    expect(hourMarks(DAY, FPS, 0)).toEqual([]);
    expect(hourMarks(0, FPS, 900)).toEqual([]);
  });
});
