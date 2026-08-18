import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingVideoBackend, openStreamingBlob, openStreamingUrl } from "../../src/lib/streaming";

// Covers the backend against a stand-in for mediabunny: what it asks the container for while
// opening a file (the whole point of the module — see its header), and how it serves frames out of
// what it decoded.

interface FakeSample {
  timestamp: number;
  closed: boolean;
  close(): void;
  toVideoFrame(): { close(): void };
}

const harness = vi.hoisted(() => ({
  /** Packet timestamps the fake container reports, in decode order. */
  timestamps: [] as number[],
  /** What the header records as the track's duration, or null when it records none. */
  metadataDuration: null as number | null,
  /** The rate a prefix scan measures. */
  packetRate: 0,
  /** The options the backend passed to `EncodedPacketSink.packets()`. */
  packetOptions: null as Record<string, unknown> | null,
  /** How many packets the backend actually walked — the cost the constant-rate path avoids. */
  packetsWalked: 0,
  /** How many packets `computePacketStats()` was asked to measure over. */
  statsTarget: null as number | null,
  track: null as unknown,
  disposed: 0,
  /** Timestamps `getSample()` was called with. */
  sampled: [] as number[],
  /** Windows `samples()` was called with. */
  windows: [] as { start: number; end: number }[],
  /** Set by a test to hand out range samples one at a time. */
  gate: null as null | { next: () => Promise<FakeSample | null> },
  /** Whoever the backend has watching the source's reads. */
  readListeners: [] as ((range: { start: number; end: number }) => void)[],
  /** Bytes the fake container reports reading per packet it is asked for — how a seek that is
   * really a walk through the file shows up from outside. */
  bytesPerPacket: 0,
  /** What the source says the whole file is, or null for one that will not say. */
  sourceSize: null as number | null,
}));

/** Reports `bytes` read from the source, as mediabunny does while it works through a container. */
function reportRead(bytes: number): void {
  if (!bytes) return;
  for (const listener of harness.readListeners) listener({ start: 0, end: bytes });
}

function sample(timestamp: number): FakeSample {
  const s: FakeSample = {
    timestamp,
    closed: false,
    close: () => {
      s.closed = true;
    },
    toVideoFrame: () => ({ close: () => {} }),
  };
  return s;
}

vi.mock("mediabunny", () => {
  class FakeSource {
    getSizeOrNull(): Promise<number | null> {
      return Promise.resolve(harness.sourceSize);
    }
    on(_event: string, listener: (range: { start: number; end: number }) => void): () => void {
      harness.readListeners.push(listener);
      return () => {
        harness.readListeners = harness.readListeners.filter((l) => l !== listener);
      };
    }
  }
  return {
    ALL_FORMATS: [],
    UrlSource: class extends FakeSource {},
    BlobSource: class extends FakeSource {},
    Input: class {
      getPrimaryVideoTrack(): Promise<unknown> {
        return Promise.resolve(harness.track);
      }
      dispose(): void {
        harness.disposed++;
      }
    },
    EncodedPacketSink: class {
      async *packets(_start: unknown, _end: unknown, options: Record<string, unknown>): AsyncGenerator<unknown> {
        harness.packetOptions = options;
        for (const timestamp of harness.timestamps) {
          harness.packetsWalked++;
          reportRead(harness.bytesPerPacket);
          yield { timestamp };
        }
      }
      getFirstPacket(): Promise<{ timestamp: number } | null> {
        const first = harness.timestamps[0];
        return Promise.resolve(first === undefined ? null : { timestamp: first });
      }
      /** The last packet at or before `timestamp`, which is what mediabunny's does. */
      getPacket(timestamp: number): Promise<{ timestamp: number } | null> {
        // A container with nothing to seek by walks to the packet instead, which is what the bytes
        // reported here stand for.
        reportRead(harness.bytesPerPacket);
        const at = harness.timestamps.filter((t) => t <= timestamp + 1e-9).sort((a, b) => b - a)[0];
        return Promise.resolve(at === undefined ? null : { timestamp: at });
      }
    },
    VideoSampleSink: class {
      getSample(timestamp: number): Promise<FakeSample | null> {
        harness.sampled.push(timestamp);
        const known = harness.timestamps.some((t) => Math.abs(t - timestamp) < 1e-9);
        return Promise.resolve(known ? sample(timestamp) : null);
      }
      async *samples(start: number, end: number): AsyncGenerator<FakeSample> {
        harness.windows.push({ start, end });
        if (harness.gate) {
          for (;;) {
            const next = await harness.gate.next();
            if (!next) return;
            yield next;
          }
        }
        for (const timestamp of harness.timestamps) {
          if (timestamp >= start && timestamp < end) yield sample(timestamp);
        }
      }
    },
  };
});

/** A frame's worth of stand-in for the ImageBitmap jsdom does not have. */
interface FakeBitmap {
  frame: unknown;
  closed: boolean;
  close(): void;
}

let bitmaps: FakeBitmap[] = [];

beforeEach(() => {
  // A five-frame track at 10fps whose header records where it ends: the constant-rate case, which
  // is what nearly every real recording is.
  harness.timestamps = [0, 0.1, 0.2, 0.3, 0.4];
  harness.metadataDuration = 0.5;
  harness.packetRate = 10;
  harness.packetOptions = null;
  harness.packetsWalked = 0;
  harness.statsTarget = null;
  harness.track = {
    displayWidth: 320,
    displayHeight: 240,
    codec: "avc",
    canDecode: () => Promise.resolve(true),
    getDurationFromMetadata: () => Promise.resolve(harness.metadataDuration),
    computePacketStats: (target: number) => {
      harness.statsTarget = target;
      return Promise.resolve({ packetCount: 0, averagePacketRate: harness.packetRate, averageBitrate: 0 });
    },
  };
  harness.disposed = 0;
  harness.sampled = [];
  harness.windows = [];
  harness.gate = null;
  harness.readListeners = [];
  harness.bytesPerPacket = 0;
  harness.sourceSize = null;
  bitmaps = [];
  vi.stubGlobal("createImageBitmap", (frame: unknown) => {
    const bitmap: FakeBitmap = {
      frame,
      closed: false,
      close: () => {
        bitmap.closed = true;
      },
    };
    bitmaps.push(bitmap);
    return Promise.resolve(bitmap);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(): Promise<StreamingVideoBackend> {
  return openStreamingBlob(new Blob([]));
}

describe("StreamingVideoBackend.open, on a constant-rate file", () => {
  it("takes the frame count from the recorded rate without walking a single packet", async () => {
    const backend = await open();
    // The regression this path exists for: a 16-hour recording holds 1.76 million packets, and
    // walking them blocks the tab for minutes and keeps their timestamps for as long as it is open.
    expect(harness.packetsWalked).toBe(0);
    expect(backend.numFrames).toBe(5);
    expect(backend.fps).toBe(10);
  });

  it("measures the rate over a prefix rather than the whole file", async () => {
    await open();
    expect(harness.statsTarget).toBeGreaterThan(0);
    expect(Number.isFinite(harness.statsTarget!)).toBe(true);
  });

  it("keeps no frame times at all, so nothing downstream builds a decode-order map", async () => {
    const backend = await open();
    expect(await backend.getFrameTimes()).toBeNull();
  });

  it("reports the shape the index implies", async () => {
    const backend = await open();
    expect(backend.width).toBe(320);
    expect(backend.height).toBe(240);
    expect(backend.shape).toEqual([5, 240, 320, 3]);
  });

  it("walks the packets after all when the file does not hold to the recorded rate", async () => {
    // The header claims twice the frames the packets actually run to.
    harness.metadataDuration = 1;
    const backend = await open();
    expect(harness.packetsWalked).toBe(5);
    expect(backend.numFrames).toBe(5);
    expect(await backend.getFrameTimes()).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });
});

describe("StreamingVideoBackend.open, against a budget on what indexing may read", () => {
  // What a long archived recording does when its container does not say where its frames are: the
  // model cannot be built from the header, and finding the frames by reading them means reading the
  // recording. Over a URL that is hours of a byte count going up with no frame ever drawn, so it is
  // bounded — and what is left is a file that will not open, which someone can at least be told.
  beforeEach(() => {
    harness.metadataDuration = null;
    harness.bytesPerPacket = 400;
  });

  it("refuses a file too large to index the moment its header turns out not to say where its frames are", async () => {
    // The case the archive's long recordings hit: the header carries no duration, so the frames
    // could only be found by reading them. Answered from the header, before a packet is walked —
    // the same refusal, and just as cheap, as the one a container on the unstreamable list gets.
    harness.sourceSize = 300 * 1024 ** 3;
    await expect(openStreamingUrl("https://videos.test/recording.mkv", { maxIndexBytes: 1024 ** 3 })).rejects.toThrow(
      /not recorded in the container, and finding out would mean reading all 300\.00 GB/,
    );
    expect(harness.packetsWalked).toBe(0);
  });

  it("still walks a file small enough to be worth walking, size known or not", async () => {
    harness.sourceSize = 500 * 1024 * 1024;
    const backend = await openStreamingUrl("https://videos.test/clip.mkv", { maxIndexBytes: 1024 ** 3 });
    expect(backend.numFrames).toBe(5);
    expect(harness.packetsWalked).toBe(5);
  });

  it("gives up rather than reading past the budget to find where the frames are", async () => {
    await expect(openStreamingUrl("https://videos.test/recording.mkv", { maxIndexBytes: 1000 })).rejects.toThrow(
      /reading the file itself to find out passed/,
    );
  });

  it("says how much it was allowed to read, so the refusal above it can quote a limit", async () => {
    harness.bytesPerPacket = 700 * 1024;
    await expect(openStreamingUrl("https://videos.test/recording.mkv", { maxIndexBytes: 1024 * 1024 })).rejects.toThrow(/1\.00 MB/);
  });

  it("disposes the input it gave up on, leaving no requests behind it", async () => {
    await expect(openStreamingUrl("https://videos.test/recording.mkv", { maxIndexBytes: 1000 })).rejects.toThrow();
    expect(harness.disposed).toBe(1);
  });

  it("opens a file that fits inside the budget, walking it as before", async () => {
    const backend = await openStreamingUrl("https://videos.test/clip.mkv", { maxIndexBytes: 10_000 });
    expect(backend.numFrames).toBe(5);
  });

  it("leaves a file already on the machine unbounded, its bytes costing nothing to read", async () => {
    const backend = await open();
    expect(backend.numFrames).toBe(5);
  });

  it("bounds the checks against a recorded rate too, which walk the file just as far", async () => {
    // The rate is recorded here, so the model is built and then probed — and on a container with
    // nothing to seek by, those probes are themselves a walk from one end to the other.
    harness.metadataDuration = 0.5;
    await expect(openStreamingUrl("https://videos.test/recording.mkv", { maxIndexBytes: 500 })).rejects.toThrow(
      /reading the file itself to find out passed/,
    );
  });
});

describe("StreamingVideoBackend.open, on a file with no recorded rate", () => {
  beforeEach(() => {
    harness.metadataDuration = null;
  });

  it("falls back to walking the packets, still without loading their data", async () => {
    const backend = await open();
    expect(harness.packetOptions).toEqual({ metadataOnly: true });
    expect(harness.packetsWalked).toBe(5);
    expect(backend.numFrames).toBe(5);
    expect(backend.fps).toBeCloseTo(10, 6);
  });

  it("hands out a copy of the frame times, so a caller sorting them cannot corrupt the index", async () => {
    const backend = await open();
    const times = (await backend.getFrameTimes())!;
    times.sort((a, b) => b - a);
    expect(await backend.getFrameTimes()).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it("gives up on a track holding no frames", async () => {
    harness.timestamps = [];
    await expect(open()).rejects.toThrow(/no frames/i);
    expect(harness.disposed).toBe(1);
  });
});

describe("StreamingVideoBackend.open, refusals", () => {
  it("gives up, releasing the source, on a file with no video track", async () => {
    harness.track = null;
    await expect(openStreamingUrl("https://example.test/video.mp4")).rejects.toThrow(/no video track/i);
    expect(harness.disposed).toBe(1);
  });

  it("gives up on a codec that cannot be decoded, rather than on a blank player", async () => {
    harness.track = { displayWidth: 320, displayHeight: 240, codec: "vp9", canDecode: () => Promise.resolve(false) };
    await expect(open()).rejects.toThrow(/cannot decode/i);
    expect(harness.disposed).toBe(1);
  });
});

describe("StreamingVideoBackend.getFrame", () => {
  it("decodes the frame at the index's timestamp", async () => {
    const backend = await open();
    const frame = await backend.getFrame(2);
    expect(frame).toBe(bitmaps[0]);
    expect(harness.sampled).toEqual([0.2]);
  });

  it("serves a frame it already holds without decoding it again", async () => {
    const backend = await open();
    const first = await backend.getFrame(1);
    expect(await backend.getFrame(1)).toBe(first);
    expect(harness.sampled).toEqual([0.1]);
  });

  it("returns null outside the video, without asking the decoder", async () => {
    const backend = await open();
    expect(await backend.getFrame(-1)).toBeNull();
    expect(await backend.getFrame(5)).toBeNull();
    expect(harness.sampled).toEqual([]);
  });

  it("returns null once the backend is closed", async () => {
    const backend = await open();
    backend.close();
    expect(await backend.getFrame(0)).toBeNull();
  });
});

describe("StreamingVideoBackend.prefetch", () => {
  it("decodes a window in one pass and serves it from the cache", async () => {
    const backend = await open();
    await backend.prefetch(1, 3);
    expect(harness.windows).toHaveLength(1);
    expect(harness.windows[0].start).toBeCloseTo(0.1, 9);
    expect(harness.windows[0].end).toBeCloseTo(0.35, 9);
    expect(bitmaps).toHaveLength(3);
    expect(await backend.getFrame(3)).toBe(bitmaps[2]);
    // Served from what the window decoded — nothing went back to the decoder for a single frame.
    expect(harness.sampled).toEqual([]);
  });

  it("does not re-decode a window it already holds", async () => {
    const backend = await open();
    await backend.prefetch(1, 2);
    await backend.prefetch(1, 2);
    expect(harness.windows).toHaveLength(1);
  });

  it("serves a seek into a window still being decoded as soon as that frame lands", async () => {
    const backend = await open();
    // Nothing past the first frame is released, so a getFrame() that waited on the whole window
    // rather than on its own frame would never resolve.
    let release!: (s: FakeSample | null) => void;
    let pending = new Promise<FakeSample | null>((r) => (release = r));
    harness.gate = { next: () => pending };
    const window = backend.prefetch(0, 4);
    release(sample(0));
    pending = new Promise<FakeSample | null>((r) => (release = r));
    const frame = await backend.getFrame(0);
    expect(frame).toBe(bitmaps[0]);
    expect(harness.sampled).toEqual([]);
    release(null);
    await window;
  });

  it("falls back to decoding the frame itself when the window went past without it", async () => {
    const backend = await open();
    harness.gate = { next: () => Promise.resolve(null) };
    const window = backend.prefetch(0, 4);
    expect(await backend.getFrame(0)).toBe(bitmaps[0]);
    expect(harness.sampled).toEqual([0]);
    await window;
  });
});

describe("StreamingVideoBackend.ensureCacheCapacity", () => {
  it("keeps a frame the old capacity would have evicted", async () => {
    const backend = await openStreamingBlob(new Blob([]), { cacheSize: 2 });
    await backend.getFrame(0);
    backend.ensureCacheCapacity(5);
    await backend.getFrame(1);
    await backend.getFrame(2);
    // Under the original 2-frame capacity this would have pushed frame 0 out; grown to 5 it does not.
    expect(await backend.getFrame(0)).toBe(bitmaps[0]);
    expect(harness.sampled).toEqual([0, 0.1, 0.2]);
  });

  it("never shrinks the cache a caller already grew", async () => {
    const backend = await openStreamingBlob(new Blob([]), { cacheSize: 2 });
    backend.ensureCacheCapacity(5);
    backend.ensureCacheCapacity(3);
    await backend.getFrame(0);
    await backend.getFrame(1);
    await backend.getFrame(2);
    // All three still fit: a smaller ask after the bigger one left the 5-frame capacity in place.
    expect(await backend.getFrame(0)).toBe(bitmaps[0]);
    expect(harness.sampled).toEqual([0, 0.1, 0.2]);
  });
});

describe("StreamingVideoBackend.close", () => {
  it("releases the decoded frames and the source behind them", async () => {
    const backend = await open();
    await backend.prefetch(0, 2);
    expect(bitmaps.every((b) => !b.closed)).toBe(true);
    backend.close();
    expect(bitmaps.every((b) => b.closed)).toBe(true);
    expect(harness.disposed).toBe(1);
  });
});
