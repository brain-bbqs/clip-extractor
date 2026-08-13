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

const harness = vi.hoisted(() => {
  const state = {
    /** Packet timestamps the fake container reports, in decode order. */
    timestamps: [] as number[],
    /** The options the backend passed to `EncodedPacketSink.packets()`. */
    packetOptions: null as Record<string, unknown> | null,
    track: null as unknown,
    disposed: 0,
    /** Timestamps `getSample()` was called with. */
    sampled: [] as number[],
    /** Windows `samples()` was called with. */
    windows: [] as { start: number; end: number }[],
    /** Set by a test to hand out range samples one at a time. */
    gate: null as null | { next: () => Promise<FakeSample | null> },
  };
  return state;
});

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
    on(): () => void {
      return () => {};
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
        for (const timestamp of harness.timestamps) yield { timestamp };
      }
    },
    VideoSampleSink: class {
      getSample(timestamp: number): Promise<FakeSample | null> {
        harness.sampled.push(timestamp);
        const known = harness.timestamps.includes(timestamp);
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
  harness.timestamps = [0, 0.1, 0.2, 0.3, 0.4];
  harness.packetOptions = null;
  harness.track = { displayWidth: 320, displayHeight: 240, codec: "avc", canDecode: () => Promise.resolve(true) };
  harness.disposed = 0;
  harness.sampled = [];
  harness.windows = [];
  harness.gate = null;
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

describe("StreamingVideoBackend.open", () => {
  it("indexes the container without loading packet data", async () => {
    await open();
    // The regression this module exists for: without metadataOnly, indexing a URL-backed video
    // reads every packet's bytes, which is the entire file before the first frame is shown.
    expect(harness.packetOptions).toEqual({ metadataOnly: true });
  });

  it("reports the shape, frame count and rate the index implies", async () => {
    const backend = await open();
    expect(backend.numFrames).toBe(5);
    expect(backend.width).toBe(320);
    expect(backend.height).toBe(240);
    expect(backend.shape).toEqual([5, 240, 320, 3]);
    expect(backend.fps).toBeCloseTo(10, 6);
  });

  it("hands out a copy of the frame times, so a caller sorting them cannot corrupt the index", async () => {
    const backend = await open();
    const times = await backend.getFrameTimes();
    times.sort((a, b) => b - a);
    expect(await backend.getFrameTimes()).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

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

  it("gives up on a track holding no frames", async () => {
    harness.timestamps = [];
    await expect(open()).rejects.toThrow(/no frames/i);
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
    expect(harness.windows).toEqual([{ start: 0.1, end: 0.35 }]);
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
