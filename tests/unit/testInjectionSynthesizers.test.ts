// The three mock-recording synthesizers in lib/testInjection.ts, against stand-ins for the
// machinery jsdom does not have: a recording canvas, MediaRecorder, and mediabunny's encoder. What
// is asserted is the shape a `?test&mock_video` preview depends on — the frames drawn, the
// timestamps written, and the deliberate mp4 mislabeling every synthesizer applies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeAudioVideoFile, synthesizeLongVideoFile, synthesizeVideoFile } from "../../src/lib/testInjection";

const media = vi.hoisted(() => ({
  /** Every CanvasSource.add(timestamp, duration) call, across all sources. */
  videoAdds: [] as { timestamp: number; duration: number }[],
  /** The options each video track was registered with (frameRate, or nothing). */
  videoTrackOptions: [] as unknown[],
  /** Every AudioSample handed to AudioSampleSource.add. */
  audioSamples: [] as Record<string, unknown>[],
  audioTracks: 0,
  finalized: 0,
}));

vi.mock("mediabunny", () => ({
  QUALITY_LOW: "quality-low",
  WebMOutputFormat: class {},
  BufferTarget: class {
    buffer: ArrayBuffer | null = null;
  },
  Output: class {
    target: { buffer: ArrayBuffer | null };
    constructor({ target }: { target: { buffer: ArrayBuffer | null } }) {
      this.target = target;
    }
    addVideoTrack(_source: unknown, options?: unknown): void {
      media.videoTrackOptions.push(options);
    }
    addAudioTrack(): void {
      media.audioTracks++;
    }
    start(): Promise<void> {
      return Promise.resolve();
    }
    finalize(): Promise<void> {
      media.finalized++;
      this.target.buffer = new TextEncoder().encode("webm-bytes").buffer as ArrayBuffer;
      return Promise.resolve();
    }
  },
  CanvasSource: class {
    add(timestamp: number, duration: number): Promise<void> {
      media.videoAdds.push({ timestamp, duration });
      return Promise.resolve();
    }
  },
  AudioSampleSource: class {
    add(sample: Record<string, unknown>): Promise<void> {
      media.audioSamples.push(sample);
      return Promise.resolve();
    }
  },
  AudioSample: class {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  },
}));

/** What MediaRecorder was asked for, and the one recording the fake makes. */
const recorder = {
  mimeType: "",
  started: 0,
  instance: null as FakeMediaRecorder | null,
};

class FakeMediaRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options: { mimeType: string }) {
    recorder.mimeType = options.mimeType;
    recorder.instance = this;
  }
  start(): void {
    recorder.started++;
  }
  stop(): void {
    this.ondataavailable?.({ data: new Blob(["vp8-chunk"]) });
    this.onstop?.();
  }
}

/** Draw calls the fake 2D context saw — enough to count frames and read their captions. */
const drawn = { captions: [] as string[] };

function fakeCanvas(): unknown {
  const ctx = {
    fillStyle: "",
    font: "",
    fillRect: vi.fn(),
    fillText: (text: string) => drawn.captions.push(text),
  };
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    captureStream: () => ({}),
  };
}

beforeEach(() => {
  media.videoAdds = [];
  media.videoTrackOptions = [];
  media.audioSamples = [];
  media.audioTracks = 0;
  media.finalized = 0;
  recorder.mimeType = "";
  recorder.started = 0;
  recorder.instance = null;
  drawn.captions = [];
  vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : null) });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("synthesizeVideoFile", () => {
  it("records the asked-for frames and hands them back named and typed as the mp4 they stand in for", async () => {
    const file = await synthesizeVideoFile(3);
    // Real VP8/WebM bytes out of MediaRecorder, deliberately mislabeled (see the module's comment).
    expect(recorder.mimeType).toBe("video/webm;codecs=vp8");
    expect(recorder.started).toBe(1);
    expect(drawn.captions).toEqual(["test frame 0", "test frame 1", "test frame 2"]);
    expect(file.name).toBe("test-injection-mock-video.mp4");
    expect(file.type).toBe("video/mp4");
    expect(file.size).toBeGreaterThan(0);
  });

  it("takes a caller's filename over the default", async () => {
    const file = await synthesizeVideoFile(1, "custom-name.mp4");
    expect(file.name).toBe("custom-name.mp4");
  });
});

describe("synthesizeAudioVideoFile", () => {
  it("writes pictures and one quiet tone side by side, at matching timestamps", async () => {
    const file = await synthesizeAudioVideoFile(3);
    expect(media.audioTracks).toBe(1);
    expect(media.videoTrackOptions).toEqual([{ frameRate: 30 }]);
    expect(media.videoAdds.map((a) => a.timestamp)).toEqual([0, 1 / 30, 2 / 30]);
    expect(media.audioSamples.map((s) => s.timestamp)).toEqual([0, 1 / 30, 2 / 30]);
    expect(media.finalized).toBe(1);
    expect(file.name).toBe("test-injection-mock-audiovideo.mp4");
    expect(file.type).toBe("video/mp4");
  });

  it("synthesizes each frame's worth of sine tone at Opus's own rate, nothing resampled", async () => {
    await synthesizeAudioVideoFile(1);
    const [sample] = media.audioSamples;
    expect(sample.format).toBe("f32");
    expect(sample.numberOfChannels).toBe(1);
    expect(sample.sampleRate).toBe(48000);
    const data = sample.data as Float32Array;
    // One 30fps frame of 48kHz samples.
    expect(data.length).toBe(1600);
    expect(data[0]).toBe(0);
    // A quiet 440Hz sine, one sample in: 0.05 * sin(2π * 440 / 48000).
    expect(data[1]).toBeCloseTo(0.05 * Math.sin((2 * Math.PI * 440) / 48000), 6);
  });
});

describe("synthesizeLongVideoFile", () => {
  it("spans the asked-for duration with one frame every ten seconds, encoded in no real time", async () => {
    const file = await synthesizeLongVideoFile(100);
    expect(media.videoAdds).toHaveLength(11);
    expect(media.videoAdds[0].timestamp).toBe(0);
    expect(media.videoAdds[10].timestamp).toBeCloseTo(100, 9);
    expect(media.videoAdds.every((a) => Math.abs(a.duration - 10) < 1e-9)).toBe(true);
    // No frameRate metadata, which would snap the far-apart timestamps back together.
    expect(media.videoTrackOptions).toEqual([undefined]);
    expect(file.name).toBe("test-injection-mock-long-video.mp4");
    expect(file.type).toBe("video/mp4");
  });

  it("captions each frame with where in the recording it sits", async () => {
    await synthesizeLongVideoFile(20);
    expect(drawn.captions).toEqual(["test frame 0 @ 0s", "test frame 1 @ 10s", "test frame 2 @ 20s"]);
  });

  it("still writes two frames for a duration shorter than its sampling", async () => {
    await synthesizeLongVideoFile(5);
    expect(media.videoAdds.map((a) => a.timestamp)).toEqual([0, 5]);
  });
});
