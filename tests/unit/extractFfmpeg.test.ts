// @vitest-environment node
// The ffmpeg.wasm route through lib/extract.ts, and the canvas routes beside it. Runs under node
// rather than jsdom for real Blob.arrayBuffer() (which jsdom lacks — same as etag.test.ts), with the
// two DOM pieces extraction actually touches — a canvas and ImageBitmap — stood in for below.
// ensureFfmpeg/runFfmpeg are stubbed (nothing here loads a real 30MB core); ffmpegArgs and the
// encoder constants stay real, so the commands asserted on are the commands the app would run.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractClip, extractFrame, extractOverlay } from "../../src/lib/extract";
import { ENCODED_PIXEL_FORMAT, X264_MP4_ARGS, ffmpegArgs } from "../../src/lib/ffmpeg";
import { InterruptedError } from "../../src/lib/interrupt";
import { blurSummary } from "../../src/lib/blur";
import type { BehEntities } from "../../src/lib/bidsPath";
import type { PoseModel, SleapVideoBackend } from "../../src/lib/types";
import type { StreamingVideoBackend } from "../../src/lib/streaming";

const harness = vi.hoisted(() => ({
  /** The fake ffmpeg.wasm filesystem handed back by the stubbed ensureFfmpeg. */
  ff: null as unknown as { writeFile: ReturnType<typeof vi.fn>; readFile: ReturnType<typeof vi.fn>; deleteFile: ReturnType<typeof vi.fn> },
  /** The log/progress handlers the most recent ensureFfmpeg call supplied. */
  handlers: {} as { onLog?: (m: string) => void; onProgress?: (e: { progress: number; time: number }) => void },
  /** Args each runFfmpeg call was given. */
  runs: [] as string[][],
  runImpl: null as null | (() => Promise<void>),
}));

vi.mock("../../src/lib/ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/ffmpeg")>();
  return {
    ...actual,
    ensureFfmpeg: (h: typeof harness.handlers = {}) => {
      harness.handlers = h;
      return Promise.resolve(harness.ff);
    },
    runFfmpeg: (_ff: unknown, args: string[]) => {
      harness.runs.push(args);
      return harness.runImpl ? harness.runImpl() : Promise.resolve();
    },
  };
});

// Only what extract.ts and lib/videoFormat.ts reach for: a container no track can be read out of,
// so producedDetail's read-back contributes nothing and `technical` is exactly what each route
// guaranteed — the half of the merge these tests are about.
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: class {},
  VideoSampleSink: class {},
  Input: class {
    getPrimaryVideoTrack(): Promise<null> {
      return Promise.resolve(null);
    }
    dispose(): void {}
  },
  VideoSample: class {
    source: unknown;
    timestamp: number;
    duration: number;
    constructor(source: unknown, opts: { timestamp: number; duration: number }) {
      this.source = source;
      this.timestamp = opts.timestamp;
      this.duration = opts.duration;
    }
  },
}));

/** A 1x1 8-bit RGBA PNG as a real encoder writes one, so pngFormatInfo can read the fake canvas's
 * output the way it reads a browser's. */
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

class FakeImageBitmap {}

interface FakeCtx {
  canvas: unknown;
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
}

const canvasControl = {
  /** Set false to preview a browser refusing a 2D context. */
  ctxAvailable: true,
  /** What toBlob hands back — null previews an encoder refusing the frame. */
  blobOut: null as Blob | null,
  contexts: [] as FakeCtx[],
};

function fakeCanvas(): unknown {
  const canvas: Record<string, unknown> = { width: 0, height: 0 };
  const ctx: FakeCtx = {
    canvas,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
  canvasControl.contexts.push(ctx);
  canvas.getContext = (kind: string) => (kind === "2d" && canvasControl.ctxAvailable ? ctx : null);
  canvas.toBlob = (cb: (b: Blob | null) => void) => cb(canvasControl.blobOut);
  return canvas;
}

const beh: BehEntities = { sub: "mice", ses: null, known: false, recording: "20260810012356482", date: "20260810", time: "012356" };

beforeEach(() => {
  harness.ff = {
    writeFile: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve(new Uint8Array(Buffer.from("mp4data")))),
    deleteFile: vi.fn(() => Promise.resolve()),
  };
  harness.handlers = {};
  harness.runs = [];
  harness.runImpl = null;
  canvasControl.ctxAvailable = true;
  canvasControl.blobOut = new Blob([PNG_1X1]);
  canvasControl.contexts = [];
  vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : null) });
  vi.stubGlobal("ImageBitmap", FakeImageBitmap);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractClip, through ffmpeg.wasm", () => {
  const selection = { sourceUrl: null, sourceName: "v.mp4", beh, lo: 600, hi: 749, fps: 30 };
  const sourceFile = new File(["sourcebytes"], "v.mp4");

  it("trims a local file frame-exactly, quoting the exact command as the file's encoding", async () => {
    const media = await extractClip({ ...selection, sourceFile });
    expect(harness.ff.writeFile).toHaveBeenCalledWith("in.mp4", new Uint8Array(Buffer.from("sourcebytes")));
    const expected = ffmpegArgs("in.mp4", "clip.mp4", 600, 749, 30, "precise", []);
    expect(harness.runs).toEqual([expected]);
    expect(media.encoding).toBe(`ffmpeg ${expected.join(" ")}`);
    expect(media.filename).toBe("sub-mice_recording-20260810012356482_video.mp4");
    expect(media.mime).toBe("video/mp4");
    expect(media.blob.size).toBeGreaterThan(0);
  });

  it("guarantees the pixel layout a re-encode was told to write, with nothing readable off the stub bytes", async () => {
    const media = await extractClip({ ...selection, sourceFile });
    expect(media.technical).toEqual(ENCODED_PIXEL_FORMAT);
  });

  it("guarantees nothing about a stream copy of a source nothing else described", async () => {
    const media = await extractClip({ ...selection, sourceFile, trim: "fast" });
    expect(media.technical).toEqual({});
  });

  it("carries the streamed source's own reading through a stream copy of the same frames", async () => {
    const technical = { codec: "h264", codecRFC6381: "avc1.640028", pixelFormat: "yuv420p", bitDepth: 8 };
    const backend = { technical } as unknown as StreamingVideoBackend;
    const media = await extractClip({ ...selection, sourceFile, backend, trim: "fast" });
    expect(media.technical).toEqual(technical);
  });

  it("names ffmpeg's input after the source's own extension, whatever the container", async () => {
    await extractClip({ ...selection, sourceFile: new File(["x"], "v.webm"), sourceName: "v.webm" });
    expect(harness.ff.writeFile).toHaveBeenCalledWith("in.webm", expect.anything());
  });

  it("falls back to .mp4 for a source name with no extension to take", async () => {
    await extractClip({ ...selection, sourceFile: new File(["x"], "recording"), sourceName: "recording" });
    expect(harness.ff.writeFile).toHaveBeenCalledWith("in.mp4", expect.anything());
  });

  it("downloads the whole source when only a URL is in hand, ffmpeg needing the full container", async () => {
    const bytes = new TextEncoder().encode("urlbytes");
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const progress: string[] = [];
    await extractClip({
      ...selection,
      sourceFile: null,
      sourceUrl: "https://example.test/v.mp4",
      signal: controller.signal,
      onProgress: (m) => progress.push(m),
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v.mp4", { signal: controller.signal });
    expect(harness.ff.writeFile).toHaveBeenCalledWith("in.mp4", new Uint8Array(bytes));
    expect(progress).toContain("Downloading the source video…");
  });

  it("reports the HTTP status when that download fails", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 503 }));
    await expect(extractClip({ ...selection, sourceFile: null, sourceUrl: "https://example.test/v.mp4" })).rejects.toThrow(
      "HTTP 503 fetching the source video",
    );
  });

  it("refuses outright when there are no source bytes at all", async () => {
    await expect(extractClip({ ...selection, sourceFile: null })).rejects.toThrow("No source bytes available for ffmpeg");
  });

  it("refuses an empty clip rather than handing back a 0-byte file", async () => {
    harness.ff.readFile.mockResolvedValue(new Uint8Array(0));
    await expect(extractClip({ ...selection, sourceFile })).rejects.toThrow(/produced an empty clip/);
  });

  it("cleans its virtual filesystem up behind itself, success or not", async () => {
    await extractClip({ ...selection, sourceFile });
    expect(harness.ff.deleteFile).toHaveBeenCalledWith("in.mp4");
    expect(harness.ff.deleteFile).toHaveBeenCalledWith("clip.mp4");
    harness.ff.deleteFile.mockClear();
    harness.ff.readFile.mockResolvedValue(new Uint8Array(0));
    await expect(extractClip({ ...selection, sourceFile })).rejects.toThrow();
    expect(harness.ff.deleteFile).toHaveBeenCalledWith("in.mp4");
  });

  it("treats a cleanup failure as the harmless leftover it is", async () => {
    harness.ff.deleteFile.mockRejectedValue(new Error("EBUSY"));
    const media = await extractClip({ ...selection, sourceFile });
    expect(media.mime).toBe("video/mp4");
  });

  it("names the silent decode up to the selection, rather than leaving a bar at 0% through it", async () => {
    const progress: [string, number | undefined][] = [];
    await extractClip({ ...selection, sourceFile, onProgress: (m, f) => progress.push([m, f]) });
    expect(progress).toContainEqual(["Decoding the source up to frame 600…", 0]);
    expect(progress).toContainEqual(["Encoding snippet… 100%", 1]);
  });

  it("skips that naming for a stream copy, which seeks straight to the selection", async () => {
    const progress: [string, number | undefined][] = [];
    await extractClip({ ...selection, sourceFile, trim: "fast", onProgress: (m, f) => progress.push([m, f]) });
    expect(progress).toContainEqual(["Encoding snippet…", 0]);
    expect(progress.some(([m]) => m.startsWith("Decoding the source"))).toBe(false);
  });

  it("re-derives encode progress against the clip being written, through the handlers it wires up", async () => {
    const progress: [string, number | undefined][] = [];
    // 150 frames at 30fps: a five-second clip, so 2.5s of output timestamp is halfway.
    await extractClip({ ...selection, sourceFile, onProgress: (m, f) => progress.push([m, f]) });
    harness.handlers.onProgress?.({ progress: 0.02, time: 2_500_000 });
    expect(progress).toContainEqual(["Encoding snippet… 50%", 0.5]);
    // AV_NOPTS_VALUE, before the first frame is muxed: nothing to report.
    const before = progress.length;
    harness.handlers.onProgress?.({ progress: 0, time: 9223372036854776000 });
    expect(progress.length).toBe(before);
  });

  it("forwards ffmpeg's own log lines to the debug console", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      await extractClip({ ...selection, sourceFile });
      harness.handlers.onLog?.("frame=  42");
      expect(debug).toHaveBeenCalledWith("[ffmpeg]", "frame=  42");
    } finally {
      debug.mockRestore();
    }
  });
});

describe("extractClip, blurring a streamed source", () => {
  it("burns the blur into each frame through a canvas, handing the muxer a fresh sample", async () => {
    const blur = [{ x: 10, y: 10, radius: 20 }];
    const extractRange = vi.fn(() =>
      Promise.resolve({ blob: new Blob(["clip"], { type: "video/mp4" }), transcoded: true, start: 1, end: 2 }),
    );
    const backend = { width: 320, height: 240, technical: {}, extractRange } as unknown as StreamingVideoBackend;
    const media = await extractClip({
      sourceFile: null,
      sourceUrl: "https://example.test/v.mp4",
      backend,
      sourceName: "v.mp4",
      beh,
      lo: 30,
      hi: 60,
      fps: 30,
      blur,
    });
    const options = vi.mocked(extractRange).mock.calls[0][2] as unknown as {
      process: (sample: { timestamp: number; duration: number; draw: ReturnType<typeof vi.fn> }) => { timestamp: number; duration: number };
    };
    expect(typeof options.process).toBe("function");
    const sample = { timestamp: 1.5, duration: 0.033, draw: vi.fn() };
    const out = options.process(sample);
    // The source frame was drawn onto the canvas and a fresh sample carries its timing — the
    // canvas itself is reused, so handing it over would let the next frame paint over this one.
    expect(sample.draw).toHaveBeenCalled();
    expect(out).not.toBe(sample);
    expect(out.timestamp).toBe(1.5);
    expect(out.duration).toBe(0.033);
    expect(media.encoding).toContain(blurSummary(blur));
  });
});

describe("extractFrame", () => {
  function backendWith(frame: unknown): SleapVideoBackend {
    return { getFrame: vi.fn(() => Promise.resolve(frame)) } as unknown as SleapVideoBackend;
  }
  const params = { frameOrder: null, frame: 5, width: 320, height: 240, beh };

  it("re-decodes the frame and encodes it as a PNG, reading the layout off the bytes written", async () => {
    const bitmap = new FakeImageBitmap();
    const backend = backendWith(bitmap);
    const media = await extractFrame({ ...params, backend });
    expect(backend.getFrame).toHaveBeenCalledWith(5);
    expect(canvasControl.contexts[0].drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(media.filename).toBe("sub-mice_recording-20260810012356482_image.png");
    expect(media.mime).toBe("image/png");
    expect(media.encoding).toBe("canvas.toBlob(image/png), decoded frame without pose overlay");
    expect(media.technical).toEqual({ pixelFormat: "rgba", bitDepth: 8 });
  });

  it("decodes through the display->decode order when the container has one", async () => {
    const backend = backendWith(new FakeImageBitmap());
    await extractFrame({ ...params, backend, frameOrder: [3, 2, 4, 0, 1, 5], frame: 1 });
    expect(backend.getFrame).toHaveBeenCalledWith(2);
  });

  it("names the blur in the encoding line when regions were burned in", async () => {
    const blur = [{ x: 10, y: 10, radius: 20 }];
    const media = await extractFrame({ ...params, backend: backendWith(new FakeImageBitmap()), blur });
    expect(media.encoding).toContain(blurSummary(blur));
  });

  it("says which frame could not be decoded, rather than saving a blank picture", async () => {
    await expect(extractFrame({ ...params, backend: backendWith(null) })).rejects.toThrow("Frame 5 could not be decoded");
  });

  it("reports a browser that cannot encode the frame as a PNG", async () => {
    canvasControl.blobOut = null;
    await expect(extractFrame({ ...params, backend: backendWith(new FakeImageBitmap()) })).rejects.toThrow(
      "The browser could not encode the frame as a PNG",
    );
  });

  it("reports a browser that hands out no 2D context at all", async () => {
    canvasControl.ctxAvailable = false;
    await expect(extractFrame({ ...params, backend: backendWith(new FakeImageBitmap()) })).rejects.toThrow("Canvas 2D context unavailable");
  });
});

describe("extractOverlay", () => {
  const pose: PoseModel = {
    skeleton: { name: "skeleton", nodes: ["a", "b"], edges: [[0, 1]] },
    tracks: ["track-0"],
    byFrame: new Map([
      [
        10,
        [
          {
            track: 0,
            kind: "predicted" as const,
            score: 0.9,
            points: [
              { x: 1, y: 2, score: 0.9 },
              { x: 3, y: 4, score: 0.8 },
            ],
          },
        ],
      ],
    ]),
  };
  const base = { frameOrder: null, pose, fps: 30, width: 320, height: 240, beh };

  function backend(): SleapVideoBackend {
    return { getFrame: vi.fn(() => Promise.resolve(new FakeImageBitmap())) } as unknown as SleapVideoBackend;
  }

  it("renders a single frame with the pose drawn into the pixels, as a PNG beside the plain one", async () => {
    const media = await extractOverlay({ ...base, backend: backend(), mode: "frame", inFrame: 10, outFrame: 10 });
    const ctx = canvasControl.contexts[0];
    expect(ctx.drawImage).toHaveBeenCalled();
    // The skeleton's one edge and two node dots actually hit the canvas.
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(media.filename).toBe("sub-mice_recording-20260810012356482_desc-overlay_image.png");
    expect(media.mime).toBe("image/png");
    expect(media.encoding).toBe("canvas.toBlob(image/png), decoded frame with the pose overlay drawn in");
    expect(media.technical).toEqual({ pixelFormat: "rgba", bitDepth: 8 });
  });

  it("draws a snippet frame by frame and encodes the PNG sequence with the shared x264 settings", async () => {
    const b = backend();
    const progress: [string, number | undefined][] = [];
    const media = await extractOverlay({
      ...base,
      backend: b,
      mode: "snippet",
      inFrame: 10,
      outFrame: 12,
      onProgress: (m, f) => progress.push([m, f]),
    });
    expect(vi.mocked(b.getFrame).mock.calls.map((c) => c[0])).toEqual([10, 11, 12]);
    expect(harness.ff.writeFile.mock.calls.map((c) => c[0])).toEqual(["ov000000.png", "ov000001.png", "ov000002.png"]);
    expect(harness.ff.writeFile).toHaveBeenCalledWith("ov000000.png", new Uint8Array(PNG_1X1));
    const expected = ["-framerate", "30.0000", "-start_number", "0", "-i", "ov%06d.png", ...X264_MP4_ARGS, "overlay.mp4"];
    expect(harness.runs).toEqual([expected]);
    expect(media.encoding).toBe(`ffmpeg ${expected.join(" ")}`);
    expect(media.filename).toBe("sub-mice_recording-20260810012356482_desc-overlay_video.mp4");
    expect(media.technical).toEqual(ENCODED_PIXEL_FORMAT);
    expect(progress).toContainEqual(["Drawing the overlay… frame 3/3", 1]);
    expect(progress).toContainEqual(["Encoding the overlay snippet… 100%", 1]);
    // The wired-up encode progress measures against the overlay's own duration: three frames at
    // 30fps is 0.1s of output, so 0.05s of written timestamp is halfway.
    harness.handlers.onProgress?.({ progress: 0.01, time: 50_000 });
    expect(progress).toContainEqual(["Encoding the overlay snippet… 50%", 0.5]);
  });

  it("names the blur beside the command, the blur living in the frames rather than in it", async () => {
    const blur = [{ x: 10, y: 10, radius: 20 }];
    const media = await extractOverlay({ ...base, backend: backend(), mode: "snippet", inFrame: 10, outFrame: 11, blur });
    expect(media.encoding).toMatch(/^ffmpeg .* \(frames drawn with 1 blurred region, gaussian sigma /);
  });

  it("cleans every written frame and the output out of the virtual filesystem", async () => {
    await extractOverlay({ ...base, backend: backend(), mode: "snippet", inFrame: 10, outFrame: 12 });
    expect(harness.ff.deleteFile.mock.calls.map((c) => c[0])).toEqual(["ov000000.png", "ov000001.png", "ov000002.png", "overlay.mp4"]);
  });

  it("refuses an empty overlay clip rather than handing back a 0-byte file", async () => {
    harness.ff.readFile.mockResolvedValue(new Uint8Array(0));
    await expect(extractOverlay({ ...base, backend: backend(), mode: "snippet", inFrame: 10, outFrame: 11 })).rejects.toThrow(
      "ffmpeg produced an empty overlay clip",
    );
  });

  it("stops between frames when the visitor asks, still cleaning up what it drew", async () => {
    const controller = new AbortController();
    const b = {
      getFrame: vi.fn(() => {
        // Stop pressed while the first frame is being drawn: the loop's own check catches it
        // before the second frame is decoded.
        controller.abort();
        return Promise.resolve(new FakeImageBitmap());
      }),
    } as unknown as SleapVideoBackend;
    await expect(
      extractOverlay({ ...base, backend: b, mode: "snippet", inFrame: 10, outFrame: 12, signal: controller.signal }),
    ).rejects.toThrow(InterruptedError);
    expect(b.getFrame).toHaveBeenCalledTimes(1);
    expect(harness.ff.deleteFile.mock.calls.map((c) => c[0])).toEqual(["ov000000.png", "overlay.mp4"]);
  });

  it("says which overlay frame could not be decoded", async () => {
    const b = { getFrame: vi.fn(() => Promise.resolve(null)) } as unknown as SleapVideoBackend;
    await expect(extractOverlay({ ...base, backend: b, mode: "snippet", inFrame: 10, outFrame: 12 })).rejects.toThrow(
      "Frame 10 could not be decoded",
    );
  });
});
