import { beforeEach, describe, expect, it, vi } from "vitest";
import { pixelFormatInfo, videoFormatInfo } from "../../src/lib/videoFormat";

// Covers the probe against a stand-in for mediabunny, since what it reads is a real container and a
// real decoded frame — neither of which exists under vitest. Every one of these cases is something a
// real file does: a track that names no parameter string, a codec this browser has no decoder for
// (H.264 in headless Chromium, the case that put the guarantees in lib/extract.ts), bytes that are
// not a video at all.

interface FakeTrack {
  codec: string | null;
  canDecode(): Promise<boolean>;
  getCodecParameterString(): Promise<string | null>;
  /** Not always zero on a real track, which is why the probe asks rather than assumes. */
  getFirstTimestamp(): Promise<number>;
}

const harness = vi.hoisted(() => ({
  track: null as unknown,
  /** Thrown out of `getPrimaryVideoTrack()` when set — a container the demuxer cannot make sense of. */
  openError: null as Error | null,
  /** The WebCodecs pixel format the decoded first sample carries, or null for no sample at all. */
  sampleFormat: null as string | null,
  /** Thrown out of `getSample()` when set — a decoder that gives out mid-frame. */
  sampleError: null as Error | null,
  /** Whether the decoded sample was released again, and whether the input behind it was. */
  sampleClosed: false,
  disposed: 0,
  /** The timestamp the sink was asked for, so the probe can be held to reading the track's own
   * first frame rather than whatever sits at zero. */
  sampledAt: null as number | null,
}));

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class {
    getPrimaryVideoTrack(): Promise<unknown> {
      if (harness.openError) return Promise.reject(harness.openError);
      return Promise.resolve(harness.track);
    }
    dispose(): void {
      harness.disposed++;
    }
  },
  VideoSampleSink: class {
    getSample(timestamp: number): Promise<{ format: string | null; close(): void } | null> {
      harness.sampledAt = timestamp;
      if (harness.sampleError) return Promise.reject(harness.sampleError);
      if (!harness.sampleFormat) return Promise.resolve(null);
      return Promise.resolve({
        format: harness.sampleFormat,
        close: () => {
          harness.sampleClosed = true;
        },
      });
    }
  },
}));

/** An H.264 track this browser can decode, as mediabunny reports one. */
function track(overrides: Partial<FakeTrack> = {}): FakeTrack {
  return {
    codec: "avc",
    canDecode: () => Promise.resolve(true),
    getCodecParameterString: () => Promise.resolve("avc1.640028"),
    getFirstTimestamp: () => Promise.resolve(1.5),
    ...overrides,
  };
}

beforeEach(() => {
  harness.track = track();
  harness.openError = null;
  harness.sampleFormat = "I420";
  harness.sampleError = null;
  harness.sampleClosed = false;
  harness.disposed = 0;
  harness.sampledAt = null;
});

describe("videoFormatInfo", () => {
  it("reports the codec, its parameter string and the layout of the frame it decoded", async () => {
    expect(await videoFormatInfo(new Blob([]))).toEqual({
      codec: "avc",
      codecRFC6381: "avc1.640028",
      pixelFormat: "yuv420p",
      bitDepth: 8,
    });
    // The track's own first frame, not whatever sits at zero: a track can start anywhere, and a
    // timestamp no sample covers reads back as no sample at all.
    expect(harness.sampledAt).toBe(1.5);
  });

  // The case the guarantees in lib/extract.ts exist for: the container still names the codec, but
  // nothing here can decode a frame to see what layout it stores.
  it("still names the codec for a track this browser has no decoder for, minus the pixel format", async () => {
    harness.track = track({ canDecode: () => Promise.resolve(false) });
    expect(await videoFormatInfo(new Blob([]))).toEqual({ codec: "avc", codecRFC6381: "avc1.640028" });
  });

  it("leaves out a parameter string the track cannot be pinned down to, keeping the looser codec name", async () => {
    harness.track = track({ getCodecParameterString: () => Promise.resolve(null) });
    const detail = await videoFormatInfo(new Blob([]));
    expect(detail.codec).toBe("avc");
    expect(detail).not.toHaveProperty("codecRFC6381");
  });

  it("survives a track whose parameter string throws instead of answering", async () => {
    harness.track = track({ getCodecParameterString: () => Promise.reject(new Error("no config")) });
    expect(await videoFormatInfo(new Blob([]))).toEqual({ codec: "avc", pixelFormat: "yuv420p", bitDepth: 8 });
  });

  it("keeps what the container said when the decoder gives out mid-frame", async () => {
    harness.sampleError = new Error("decoder crashed");
    expect(await videoFormatInfo(new Blob([]))).toEqual({ codec: "avc", codecRFC6381: "avc1.640028" });
  });

  it("keeps what the container said when even the decodability check throws", async () => {
    harness.track = track({ canDecode: () => Promise.reject(new Error("no codec registry")) });
    expect(await videoFormatInfo(new Blob([]))).toEqual({ codec: "avc", codecRFC6381: "avc1.640028" });
  });

  it("falls back to the frame at zero when the track will not say where it starts", async () => {
    harness.track = track({ getFirstTimestamp: () => Promise.reject(new Error("no index")) });
    expect(await videoFormatInfo(new Blob([]))).toEqual({
      codec: "avc",
      codecRFC6381: "avc1.640028",
      pixelFormat: "yuv420p",
      bitDepth: 8,
    });
    expect(harness.sampledAt).toBe(0);
  });

  it("claims nothing for a layout FFmpeg's own vocabulary has no name for", async () => {
    harness.sampleFormat = "NOTAFORMAT";
    const detail = await videoFormatInfo(new Blob([]));
    expect(detail).not.toHaveProperty("pixelFormat");
    expect(detail).not.toHaveProperty("bitDepth");
  });

  it("claims nothing at all for a file holding no video track", async () => {
    harness.track = null;
    expect(await videoFormatInfo(new Blob([]))).toEqual({});
  });

  it("claims nothing at all about bytes that are not a video, rather than throwing", async () => {
    harness.openError = new Error("unrecognized container");
    await expect(videoFormatInfo(new Blob(["not a video"]))).resolves.toEqual({});
  });

  it("releases the decoded frame and the input behind it, whether or not it could read anything", async () => {
    await videoFormatInfo(new Blob([]));
    expect(harness.sampleClosed).toBe(true);
    expect(harness.disposed).toBe(1);
    harness.openError = new Error("unrecognized container");
    await videoFormatInfo(new Blob([]));
    expect(harness.disposed).toBe(2);
  });
});

describe("pixelFormatInfo", () => {
  it("names an 8-bit planar YUV format after FFmpeg's own pix_fmt, with no depth suffix", () => {
    expect(pixelFormatInfo("I420")).toEqual({ pixelFormat: "yuv420p", bitDepth: 8 });
    expect(pixelFormatInfo("I444")).toEqual({ pixelFormat: "yuv444p", bitDepth: 8 });
  });

  it("names the alpha variant with FFmpeg's own yuva prefix", () => {
    expect(pixelFormatInfo("I420A")).toEqual({ pixelFormat: "yuva420p", bitDepth: 8 });
  });

  it("names a higher bit depth with FFmpeg's own p10le/p12le suffix", () => {
    expect(pixelFormatInfo("I420P10")).toEqual({ pixelFormat: "yuv420p10le", bitDepth: 10 });
    expect(pixelFormatInfo("I422P12")).toEqual({ pixelFormat: "yuv422p12le", bitDepth: 12 });
  });

  it("combines alpha and a higher bit depth", () => {
    expect(pixelFormatInfo("I444AP10")).toEqual({ pixelFormat: "yuva444p10le", bitDepth: 10 });
  });

  it("names the packed formats FFmpeg's own way, always 8-bit", () => {
    expect(pixelFormatInfo("NV12")).toEqual({ pixelFormat: "nv12", bitDepth: 8 });
    expect(pixelFormatInfo("RGBA")).toEqual({ pixelFormat: "rgba", bitDepth: 8 });
    expect(pixelFormatInfo("RGBX")).toEqual({ pixelFormat: "rgb0", bitDepth: 8 });
    expect(pixelFormatInfo("BGRA")).toEqual({ pixelFormat: "bgra", bitDepth: 8 });
    expect(pixelFormatInfo("BGRX")).toEqual({ pixelFormat: "bgr0", bitDepth: 8 });
  });
});
