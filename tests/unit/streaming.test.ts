import { describe, expect, it } from "vitest";
import { FrameCache, decodeWindow, fpsFromSpan, nearestIndex } from "../../src/lib/streaming";

/** A stand-in for a decoded frame: jsdom has no ImageBitmap, and all the cache asks of one is that
 * it can be closed. */
function frame(): { close: () => void; closed: boolean } {
  const f = {
    closed: false,
    close: () => {
      f.closed = true;
    },
  };
  return f;
}

describe("FrameCache", () => {
  it("returns what it was given, and null for what it was not", () => {
    const cache = new FrameCache(4);
    const a = frame();
    cache.set(1, a);
    expect(cache.get(1)).toBe(a);
    expect(cache.get(2)).toBeNull();
    expect(cache.has(1)).toBe(true);
  });

  it("closes the least recently used frame once it is over its limit", () => {
    const cache = new FrameCache(2);
    const [a, b, c] = [frame(), frame(), frame()];
    cache.set(0, a);
    cache.set(1, b);
    cache.set(2, c);
    expect(cache.size).toBe(2);
    expect(a.closed).toBe(true);
    expect(cache.get(0)).toBeNull();
    expect(cache.get(1)).toBe(b);
    expect(cache.get(2)).toBe(c);
  });

  it("counts a lookup as a use, so the frame just read is not the next one evicted", () => {
    const cache = new FrameCache(2);
    const [a, b, c] = [frame(), frame(), frame()];
    cache.set(0, a);
    cache.set(1, b);
    cache.get(0);
    cache.set(2, c);
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(true);
    expect(cache.get(0)).toBe(a);
  });

  it("keeps the frame already held and closes the duplicate, so a held bitmap stays valid", () => {
    const cache = new FrameCache(2);
    const [first, second] = [frame(), frame()];
    cache.set(0, first);
    cache.set(0, second);
    expect(cache.get(0)).toBe(first);
    expect(second.closed).toBe(true);
    expect(first.closed).toBe(false);
  });

  it("closes everything it holds when cleared", () => {
    const cache = new FrameCache(4);
    const [a, b] = [frame(), frame()];
    cache.set(0, a);
    cache.set(1, b);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
  });
});

describe("fpsFromSpan", () => {
  it("counts the intervals between the frames, not the frames", () => {
    expect(fpsFromSpan(31, 1)).toBe(30);
  });

  it("gives up on a span nothing can be measured over", () => {
    expect(fpsFromSpan(1, 1)).toBeNull();
    expect(fpsFromSpan(0, 0)).toBeNull();
    expect(fpsFromSpan(31, 0)).toBeNull();
    expect(fpsFromSpan(31, Infinity)).toBeNull();
  });
});

describe("decodeWindow", () => {
  const times = [0, 0.1, 0.2, 0.3, 0.4];

  it("spans the requested frames, ending half a frame past the last one", () => {
    expect(decodeWindow(times, 1, 3, 0.1)).toEqual({ start: 0.1, end: 0.35 });
  });

  it("takes the smallest and largest timestamp, so reordered frames are still covered", () => {
    // Decode order for a file with B-frames: the range's last packet is not its last frame.
    expect(decodeWindow([0, 0.3, 0.1, 0.2], 1, 2, 0.1)).toEqual({ start: 0.1, end: 0.35 });
  });

  it("accepts its bounds in either order and clamps them to the index", () => {
    expect(decodeWindow(times, 3, 1, 0.1)).toEqual({ start: 0.1, end: 0.35 });
    expect(decodeWindow(times, -5, 99, 0.1)).toEqual({ start: 0, end: 0.45 });
  });

  it("still ends past the last frame when there is no frame duration to nudge by", () => {
    const window = decodeWindow(times, 2, 2, 0);
    expect(window!.start).toBe(0.2);
    expect(window!.end).toBeGreaterThan(0.2);
  });

  it("returns null when there is nothing to decode", () => {
    expect(decodeWindow([], 0, 0, 0.1)).toBeNull();
  });
});

describe("nearestIndex", () => {
  const times = [0, 0.1, 0.2, 0.3];

  it("finds the frame a timestamp belongs to despite rounding", () => {
    expect(nearestIndex(times, 0, 3, 0.20001)).toBe(2);
  });

  it("searches only inside the range it was given", () => {
    expect(nearestIndex(times, 0, 1, 0.3)).toBe(1);
  });

  it("returns null for an empty range", () => {
    expect(nearestIndex(times, 2, 1, 0.1)).toBeNull();
  });
});
