import { describe, expect, it, vi } from "vitest";
import {
  bundleFileName,
  clipFileName,
  extractClip,
  extractFrame,
  extractOverlay,
  frameFileName,
  overlayFileName,
  sidecarFileName,
} from "../../src/lib/extract";
import { InterruptedError } from "../../src/lib/interrupt";
import type { BehEntities } from "../../src/lib/bidsPath";
import type { StreamingVideoBackend } from "../../src/lib/streaming";

// A streamed source must never reach ffmpeg: it works out of a virtual filesystem, so it would
// need the whole container downloaded into memory first. The stub fails loudly if it is asked for.
const ffmpeg = vi.hoisted(() => ({ loaded: 0 }));
vi.mock("../../src/lib/ffmpeg", () => ({
  ensureFfmpeg: () => {
    ffmpeg.loaded++;
    return Promise.reject(new Error("ffmpeg stub"));
  },
  ffmpegArgs: () => [],
  streamCopies: () => false,
  encodedFraction: () => null,
}));

const beh: BehEntities = { sub: "mice", ses: null, known: false, recording: "20260810012356482", date: "20260810", time: "012356" };
const behWithSession: BehEntities = { ...beh, sub: "1", ses: "2" };

describe("clipFileName", () => {
  it("names a snippet in BEP047 entity style, with the delivery's own recording- entity", () => {
    expect(clipFileName(beh)).toBe("sub-mice_recording-20260810012356482_video.mp4");
  });

  it("includes the session entity when there is one", () => {
    expect(clipFileName(behWithSession)).toBe("sub-1_ses-2_recording-20260810012356482_video.mp4");
  });
});

describe("frameFileName", () => {
  it("names a single frame with BEP047's still-image suffix", () => {
    expect(frameFileName(beh)).toBe("sub-mice_recording-20260810012356482_image.png");
  });
});

describe("sidecarFileName", () => {
  it("mirrors the video it describes, `.json` in place of the media extension", () => {
    expect(sidecarFileName(beh, "snippet")).toBe("sub-mice_recording-20260810012356482_video.json");
  });

  it("mirrors a single frame's image the same way", () => {
    expect(sidecarFileName(beh, "frame")).toBe("sub-mice_recording-20260810012356482_image.json");
  });

  it("takes a desc entity when given one", () => {
    expect(sidecarFileName(beh, "snippet", "overlay")).toBe("sub-mice_recording-20260810012356482_desc-overlay_video.json");
  });
});

describe("overlayFileName", () => {
  it("takes desc-overlay, where the plain snippet carries no desc- at all", () => {
    expect(overlayFileName(beh, "snippet")).toBe("sub-mice_recording-20260810012356482_desc-overlay_video.mp4");
  });

  it("renders a single frame as a PNG of the same entities", () => {
    expect(overlayFileName(beh, "frame")).toBe("sub-mice_recording-20260810012356482_desc-overlay_image.png");
  });

  it("shares every entity with the plain extract it renders, differing only in desc-", () => {
    const plain = frameFileName(beh);
    expect(overlayFileName(beh, "frame")).toBe(plain.replace("_image.png", "_desc-overlay_image.png"));
  });
});

describe("bundleFileName", () => {
  // No BIDS entities at all: the bundle is a download, not a file in the tree it holds, and stops
  // existing the moment it is unpacked (see this module's own header comment).
  it("names the bundle after the dandiset its source video came out of", () => {
    expect(bundleFileName("000123")).toBe("000123.tar.gz");
  });

  it("falls back to local-dataset for a video that came from no dataset — a locally dropped file", () => {
    expect(bundleFileName(null)).toBe("local-dataset.tar.gz");
    expect(bundleFileName("")).toBe("local-dataset.tar.gz");
  });
});

describe("extractClip, on a streamed source", () => {
  function streamingBackend(transcoded = true) {
    return {
      width: 320,
      height: 240,
      codec: "vp9",
      technical: { codec: "vp9", codecRFC6381: "vp09.00.10.08", pixelFormat: "yuv420p", bitDepth: 8 },
      extractRange: vi.fn(() => Promise.resolve({ blob: new Blob(["clip"], { type: "video/mp4" }), transcoded, start: 20, end: 25 })),
    } as unknown as StreamingVideoBackend;
  }

  const selection = { sourceUrl: "https://example.test/v.mp4", sourceName: "v.mp4", beh, lo: 600, hi: 749, fps: 30 };

  it("cuts the selection out of the stream, without ever loading ffmpeg", async () => {
    ffmpeg.loaded = 0;
    const backend = streamingBackend();
    const media = await extractClip({ ...selection, sourceFile: null, backend });
    expect(ffmpeg.loaded).toBe(0);
    expect(backend.extractRange).toHaveBeenCalledWith(600, 749, expect.objectContaining({ precise: true }));
    expect(media.filename).toBe("sub-mice_recording-20260810012356482_video.mp4");
    expect(media.mime).toBe("video/mp4");
  });

  it("hands the delivery's interrupt to the trim, so a long snippet can be stopped mid-cut", async () => {
    const backend = streamingBackend();
    const controller = new AbortController();
    const media = await extractClip({ ...selection, sourceFile: null, backend, signal: controller.signal });
    expect(backend.extractRange).toHaveBeenCalledWith(600, 749, expect.objectContaining({ signal: controller.signal }));
    expect(media.filename).toBe("sub-mice_recording-20260810012356482_video.mp4");
    expect(media.mime).toBe("video/mp4");
  });

  it("records how the cut was made, for the sidecar", async () => {
    const media = await extractClip({ ...selection, sourceFile: null, backend: streamingBackend() });
    expect(media.encoding).toContain("20.000s–25.000s");
    expect(media.encoding).toContain("re-encoded");
    expect(media.encoding).toContain("audio dropped");
  });

  // The stub hands back four bytes no demuxer can open, so reading the cut back establishes nothing
  // — which leaves only what making it that way guaranteed.
  it("claims nothing about a re-encode it cannot read back: mediabunny's own choice guarantees none of it", async () => {
    const media = await extractClip({ ...selection, sourceFile: null, backend: streamingBackend(true) });
    expect(media.technical).toEqual({});
  });

  it("carries the source's own bitstream forward for a straight copy, those being the very frames copied", async () => {
    const media = await extractClip({ ...selection, sourceFile: null, backend: streamingBackend(false) });
    expect(media.technical).toEqual({ codec: "vp9", codecRFC6381: "vp09.00.10.08", pixelFormat: "yuv420p", bitDepth: 8 });
  });

  it("asks for a copy rather than a frame-exact cut in fast trim mode", async () => {
    const backend = streamingBackend();
    await extractClip({ ...selection, sourceFile: null, backend, trim: "fast" });
    expect(backend.extractRange).toHaveBeenCalledWith(600, 749, expect.objectContaining({ precise: false }));
  });

  it("draws nothing into the frames when there is no blur to draw", async () => {
    const backend = streamingBackend();
    await extractClip({ ...selection, sourceFile: null, backend });
    expect(vi.mocked(backend.extractRange).mock.calls[0][2].process).toBeUndefined();
  });

  it("goes to ffmpeg instead when the bytes are already in the browser", async () => {
    ffmpeg.loaded = 0;
    const backend = streamingBackend();
    await expect(extractClip({ ...selection, sourceFile: new File(["bytes"], "v.mp4"), backend })).rejects.toThrow(/ffmpeg stub/);
    expect(ffmpeg.loaded).toBe(1);
    expect(backend.extractRange).not.toHaveBeenCalled();
  });
});

// A delivery that was stopped (see lib/interrupt.ts) must not go on decoding, drawing or encoding
// what it was asked for: every entry point reads the interrupt before it does any of that.
describe("extraction after the delivery was stopped", () => {
  const backend = { getFrame: vi.fn(() => Promise.resolve(null)) } as unknown as Parameters<typeof extractFrame>[0]["backend"];
  const stopped = () => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  };

  it("decodes no frame for a still image", async () => {
    const signal = stopped();
    await expect(extractFrame({ backend, frameOrder: null, frame: 5, width: 320, height: 240, beh, signal })).rejects.toThrow(
      InterruptedError,
    );
    expect(backend.getFrame).not.toHaveBeenCalled();
  });

  it("draws no pose overlay", async () => {
    const signal = stopped();
    await expect(
      extractOverlay({
        backend,
        frameOrder: null,
        pose: { byFrame: new Map(), skeleton: [] } as unknown as Parameters<typeof extractOverlay>[0]["pose"],
        mode: "frame",
        inFrame: 5,
        outFrame: 5,
        fps: 30,
        width: 320,
        height: 240,
        beh,
        signal,
      }),
    ).rejects.toThrow(InterruptedError);
    expect(backend.getFrame).not.toHaveBeenCalled();
  });

  it("never loads ffmpeg for a snippet", async () => {
    ffmpeg.loaded = 0;
    await expect(
      extractClip({
        sourceFile: new File(["v"], "v.mp4"),
        sourceUrl: null,
        sourceName: "v.mp4",
        beh,
        lo: 0,
        hi: 10,
        fps: 30,
        signal: stopped(),
      }),
    ).rejects.toThrow(InterruptedError);
    expect(ffmpeg.loaded).toBe(0);
  });
});
