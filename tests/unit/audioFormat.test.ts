import { beforeEach, describe, expect, it, vi } from "vitest";
import { audioCodecInfo, audioFormatInfo } from "../../src/lib/audioFormat";

// Covers the probe against a stand-in for mediabunny, the same way videoFormat.test.ts does: what it
// reads is a real container, which does not exist under vitest. Every case here is something a real
// file does — a stereo AAC track, uncompressed PCM whose codec name states its own sample width, a
// track that names no parameter string, a silent recording, bytes that are not media at all.

interface FakeTrack {
  getCodec(): Promise<string | null>;
  getCodecParameterString(): Promise<string | null>;
  getSampleRate(): Promise<number>;
  getNumberOfChannels(): Promise<number>;
}

const harness = vi.hoisted(() => ({
  track: null as unknown,
  /** Thrown out of `getPrimaryAudioTrack()` when set — a container the demuxer cannot make sense of. */
  openError: null as Error | null,
  disposed: 0,
}));

vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  Input: class {
    getPrimaryAudioTrack(): Promise<unknown> {
      if (harness.openError) return Promise.reject(harness.openError);
      return Promise.resolve(harness.track);
    }
    dispose(): void {
      harness.disposed++;
    }
  },
}));

/** A 48kHz stereo AAC track, as mediabunny reports one. */
function track(overrides: Partial<FakeTrack> = {}): FakeTrack {
  return {
    getCodec: () => Promise.resolve("aac"),
    getCodecParameterString: () => Promise.resolve("mp4a.40.2"),
    getSampleRate: () => Promise.resolve(48000),
    getNumberOfChannels: () => Promise.resolve(2),
    ...overrides,
  };
}

beforeEach(() => {
  harness.track = track();
  harness.openError = null;
  harness.disposed = 0;
});

describe("audioFormatInfo", () => {
  it("reports the codec, its parameter string, the sample rate and the channel count", async () => {
    expect(await audioFormatInfo(new Blob([]))).toEqual({
      codec: "aac",
      codecRFC6381: "mp4a.40.2",
      sampleRate: 48000,
      channelCount: 2,
    });
  });

  // The one family whose codec name is itself the sample format, so `AudioBitDepth` can be said at
  // all without decoding the stream.
  it("reads the bit depth of uncompressed audio out of the codec name", async () => {
    harness.track = track({ getCodec: () => Promise.resolve("pcm-s24be"), getNumberOfChannels: () => Promise.resolve(1) });
    expect(await audioFormatInfo(new Blob([]))).toMatchObject({ codec: "pcm_s24be", bitDepth: 24, channelCount: 1 });
  });

  it("claims no bit depth for a compressed codec, whose name says nothing about one", async () => {
    expect(await audioFormatInfo(new Blob([]))).not.toHaveProperty("bitDepth");
  });

  it("leaves out a parameter string the track cannot be pinned down to, keeping the looser codec name", async () => {
    harness.track = track({ getCodecParameterString: () => Promise.resolve(null) });
    const detail = await audioFormatInfo(new Blob([]));
    expect(detail?.codec).toBe("aac");
    expect(detail).not.toHaveProperty("codecRFC6381");
  });

  it("survives a track whose readings throw instead of answering, still reporting a track is there", async () => {
    harness.track = track({
      getCodec: () => Promise.reject(new Error("unknown codec")),
      getCodecParameterString: () => Promise.reject(new Error("no config")),
      getSampleRate: () => Promise.reject(new Error("no rate")),
      getNumberOfChannels: () => Promise.reject(new Error("no channels")),
    });
    expect(await audioFormatInfo(new Blob([]))).toEqual({});
  });

  // BEP047 constrains both: a rate above zero, at least one channel. A container answering with
  // neither is under-describing its track, not describing a zero-channel one.
  it("writes neither a zero sample rate nor a zero channel count", async () => {
    harness.track = track({ getSampleRate: () => Promise.resolve(0), getNumberOfChannels: () => Promise.resolve(0) });
    const detail = await audioFormatInfo(new Blob([]));
    expect(detail).not.toHaveProperty("sampleRate");
    expect(detail).not.toHaveProperty("channelCount");
  });

  // Null and {} mean different things here: the first is what picks BEP047's `_video` suffix over
  // `_audiovideo`, the second a track that is there but says nothing about itself.
  it("reads a file with no audio track as silent", async () => {
    harness.track = null;
    expect(await audioFormatInfo(new Blob([]))).toBeNull();
  });

  it("reads bytes that are not media at all as silent, rather than throwing", async () => {
    harness.openError = new Error("unrecognized container");
    await expect(audioFormatInfo(new Blob(["not a video"]))).resolves.toBeNull();
  });

  it("releases the input behind it, whether or not it could read anything", async () => {
    await audioFormatInfo(new Blob([]));
    expect(harness.disposed).toBe(1);
    harness.openError = new Error("unrecognized container");
    await audioFormatInfo(new Blob([]));
    expect(harness.disposed).toBe(2);
  });
});

describe("audioCodecInfo", () => {
  it("names the PCM family FFmpeg's own way, with the sample width its name states", () => {
    expect(audioCodecInfo("pcm-s16")).toEqual({ codec: "pcm_s16le", bitDepth: 16 });
    expect(audioCodecInfo("pcm-f32be")).toEqual({ codec: "pcm_f32be", bitDepth: 32 });
    expect(audioCodecInfo("pcm-u8")).toEqual({ codec: "pcm_u8", bitDepth: 8 });
  });

  it("names the companded formats after FFmpeg's own pcm_mulaw/pcm_alaw", () => {
    expect(audioCodecInfo("ulaw")).toEqual({ codec: "pcm_mulaw", bitDepth: 8 });
    expect(audioCodecInfo("alaw")).toEqual({ codec: "pcm_alaw", bitDepth: 8 });
  });

  it("passes the compressed codecs through, already spelled the way FFmpeg spells them", () => {
    expect(audioCodecInfo("opus")).toEqual({ codec: "opus" });
    expect(audioCodecInfo("flac")).toEqual({ codec: "flac" });
    expect(audioCodecInfo("eac3")).toEqual({ codec: "eac3" });
  });
});
