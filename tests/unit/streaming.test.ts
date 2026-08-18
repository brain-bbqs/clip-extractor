import { describe, expect, it } from "vitest";
import {
  FrameCache,
  constantRateIndex,
  defaultCacheSize,
  enumeratedIndex,
  fpsFromSpan,
  modelHolds,
  nearestIndex,
} from "../../src/lib/streaming";

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

  it("grows without evicting anything already held", () => {
    const cache = new FrameCache(2);
    const [a, b] = [frame(), frame()];
    cache.set(0, a);
    cache.set(1, b);
    cache.setCapacity(4);
    expect(cache.capacity).toBe(4);
    expect(a.closed).toBe(false);
    expect(b.closed).toBe(false);
    cache.set(2, frame());
    cache.set(3, frame());
    expect(cache.size).toBe(4);
    expect(a.closed).toBe(false);
  });

  it("shrinking evicts from the front, same as running over the old limit would", () => {
    const cache = new FrameCache(4);
    const [a, b, c] = [frame(), frame(), frame()];
    cache.set(0, a);
    cache.set(1, b);
    cache.set(2, c);
    cache.setCapacity(2);
    expect(cache.size).toBe(2);
    expect(a.closed).toBe(true);
    expect(cache.get(1)).toBe(b);
    expect(cache.get(2)).toBe(c);
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

describe("constantRateIndex", () => {
  const index = constantRateIndex(0, 30, 1_755_850);

  it("places a frame from the rate alone, holding no list of them", () => {
    expect(index.count).toBe(1_755_850);
    expect(index.time(0)).toBe(0);
    expect(index.time(1_755_849)).toBeCloseTo(58528.3, 6);
    // The whole point: 1.76 million timestamps that never had to be read or kept.
    expect(index.times()).toBeNull();
  });

  it("carries an offset, for a track whose first frame is not at zero", () => {
    const offset = constantRateIndex(10, 30, 100);
    expect(offset.time(0)).toBe(10);
    expect(offset.time(30)).toBe(11);
  });

  it("ends a window half a frame past its last frame, which is exclusive", () => {
    const window = index.window(0, 29);
    expect(window.start).toBe(0);
    expect(window.end).toBeCloseTo(29 / 30 + 1 / 60, 9);
  });

  it("puts a decoded sample on its frame, and rejects one outside the window", () => {
    expect(index.indexAt(1, 0, 100)).toBe(30);
    // A decoder's timestamp need not match the container's to the last decimal.
    expect(index.indexAt(1.0001, 0, 100)).toBe(30);
    expect(index.indexAt(10, 0, 100)).toBeNull();
  });
});

describe("enumeratedIndex", () => {
  const times = [0, 0.1, 0.2, 0.3, 0.4];

  it("places frames from the list, and hands it back for the decode-order map", () => {
    const index = enumeratedIndex(times);
    expect(index.count).toBe(5);
    expect(index.time(3)).toBe(0.3);
    expect(index.fps).toBeCloseTo(10, 9);
    expect(index.times()).toEqual(times);
  });

  it("hands back a copy, so a caller sorting it cannot corrupt the index", () => {
    const index = enumeratedIndex(times);
    index.times()!.sort((a, b) => b - a);
    expect(index.times()).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it("bounds a window by the smallest and largest timestamp, covering reordered frames", () => {
    // Decode order for a file with B-frames: the range's last packet is not its last frame.
    const index = enumeratedIndex([0, 0.3, 0.1, 0.2]);
    const window = index.window(1, 2);
    expect(window.start).toBe(0.1);
    expect(window.end).toBeGreaterThan(0.3);
  });

  it("matches a sample to its frame exactly, then by nearest within the window", () => {
    const index = enumeratedIndex(times);
    expect(index.indexAt(0.2, 0, 4)).toBe(2);
    expect(index.indexAt(0.20001, 0, 4)).toBe(2);
    expect(index.indexAt(0.4, 0, 1)).toBe(1);
  });
});

describe("modelHolds", () => {
  /** Frames every 1/30s, as `getPacket` serves them: the last one at or before the timestamp. */
  function packetsFor(count: number, fps = 30) {
    return (timestamp: number) => {
      const at = Math.min(count - 1, Math.floor(timestamp * fps + 1e-9));
      return Promise.resolve(at < 0 ? null : { timestamp: at / fps });
    };
  }

  it("accepts a file whose frames really do sit at the rate's timestamps", async () => {
    expect(await modelHolds(packetsFor(300), constantRateIndex(0, 30, 300))).toBe(true);
  });

  it("refuses a count that runs past the frames the file actually holds", async () => {
    // The rate says 400 frames; the file stops at 300, so one frame past the claimed end lands
    // nowhere near where the model says the last frame is.
    expect(await modelHolds(packetsFor(300), constantRateIndex(0, 30, 400))).toBe(false);
  });

  it("refuses a rate the frames do not follow", async () => {
    expect(await modelHolds(packetsFor(300, 25), constantRateIndex(0, 30, 300))).toBe(false);
  });

  it("refuses a file with nothing at the probed timestamps", async () => {
    expect(await modelHolds(() => Promise.resolve(null), constantRateIndex(0, 30, 300))).toBe(false);
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

describe("defaultCacheSize", () => {
  it("covers a 20 second loop at an ordinary frame rate and picture size", () => {
    // A small enough picture that the byte ceiling has no say: 30fps * 20s frames, exactly.
    expect(defaultCacheSize(30, 320, 240)).toBe(600);
  });

  it("never drops below the read-ahead floor for a slow or tiny video", () => {
    // 1fps * 20s wants only 20 frames, fewer than the read-ahead window needs held at once.
    expect(defaultCacheSize(1, 320, 240)).toBe(32);
  });

  it("holds a large picture to a fraction of what a full 20 second loop would cost", () => {
    // 20s @ 60fps of 4K frames would be 1200 * 3840*2160*4 bytes ≈ 39.6GB uncapped; the byte
    // ceiling caps it well short of that, even though the read-ahead floor keeps it above zero.
    const size = defaultCacheSize(60, 3840, 2160);
    expect(size).toBeLessThan(1200);
    expect(size * 3840 * 2160 * 4).toBeLessThan(1200 * 3840 * 2160 * 4);
  });
});
