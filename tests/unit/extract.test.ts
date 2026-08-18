import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bidsLabel,
  bundleFileName,
  clipFileName,
  frameFileName,
  overlayFileName,
  provenanceFileName,
  extractClip,
  sourceBaseName,
} from "../../src/lib/extract";
import type { StreamingVideoBackend } from "../../src/lib/streaming";

// A streamed source must never reach ffmpeg: it works out of a virtual filesystem, so it would
// need the whole container downloaded into memory first. The stub fails loudly if it is asked for,
// unless a spec has put an instance in its way to be handed one.
const ffmpeg = vi.hoisted(() => ({ loaded: 0, instance: null as unknown }));
vi.mock("../../src/lib/ffmpeg", () => ({
  ensureFfmpeg: () => {
    ffmpeg.loaded++;
    return ffmpeg.instance ? Promise.resolve(ffmpeg.instance) : Promise.reject(new Error("ffmpeg stub"));
  },
  ffmpegArgs: () => ["-i", "in.mp4", "clip.mp4"],
  streamCopies: () => false,
  encodedFraction: () => null,
}));

afterEach(() => {
  ffmpeg.instance = null;
});

describe("sourceBaseName", () => {
  it("drops the extension", () => {
    expect(sourceBaseName("mice.mp4")).toBe("mice");
  });

  it("keeps dots that are part of the name", () => {
    expect(sourceBaseName("mice.tracked.session.avi")).toBe("mice.tracked.session");
  });

  it("falls back for an extension-only name", () => {
    expect(sourceBaseName(".mp4")).toBe("clip");
  });
});

describe("bidsLabel", () => {
  it("keeps an already-legal label untouched", () => {
    expect(bidsLabel("mice")).toBe("mice");
  });

  it("turns spaces into + so word boundaries survive", () => {
    expect(bidsLabel("my clip")).toBe("my+clip");
  });

  it("turns an underscore into + too, rather than closing the gap", () => {
    expect(bidsLabel("mice_new")).toBe("mice+new");
  });

  it("marks every kind of separator the same way, since none can survive as itself", () => {
    expect(bidsLabel("file_example_480 - Copy")).toBe("file+example+480+Copy");
  });

  it("collapses a run of separators into a single +", () => {
    expect(bidsLabel("a  -  b")).toBe("a+b");
  });

  it("folds an accent into its base letter instead of splitting there", () => {
    expect(bidsLabel("naïve1")).toBe("naive1");
  });

  it("strips accents rather than replacing them", () => {
    expect(bidsLabel("café")).toBe("cafe");
  });

  it("falls back when nothing legal is left", () => {
    expect(bidsLabel("___")).toBe("clip");
  });
});

describe("clipFileName", () => {
  it("names a snippet with its frame range in BIDS entity style", () => {
    expect(clipFileName("mice.mp4", 120, 300)).toBe("name-mice_range-120+300_type-snippet_video.mp4");
  });

  it("reduces the source name to a legal label", () => {
    expect(clipFileName("my video - Copy.mp4", 0, 20)).toBe("name-my+video+Copy_range-0+20_type-snippet_video.mp4");
  });
});

describe("frameFileName", () => {
  it("names a single frame with its index in BIDS entity style", () => {
    expect(frameFileName("mice.mp4", 42)).toBe("name-mice_index-42_type-frame_image.png");
  });
});

describe("provenanceFileName", () => {
  it("mirrors the snippet it describes, down to its type entity, plus a provenance suffix", () => {
    expect(provenanceFileName({ sourceName: "mice.mp4", mode: "snippet", inFrame: 120, outFrame: 300 })).toBe(
      "name-mice_range-120+300_type-snippet_provenance.json",
    );
  });

  it("mirrors a single frame the same way", () => {
    expect(provenanceFileName({ sourceName: "mice.mp4", mode: "frame", inFrame: 42, outFrame: 42 })).toBe(
      "name-mice_index-42_type-frame_provenance.json",
    );
  });
});

describe("overlayFileName", () => {
  it("takes an overlay suffix in place of the plain snippet's video one", () => {
    expect(overlayFileName({ sourceName: "mice.mp4", mode: "snippet", inFrame: 120, outFrame: 300 })).toBe(
      "name-mice_range-120+300_type-snippet_overlay.mp4",
    );
  });

  it("renders a single frame as a PNG of the same index", () => {
    expect(overlayFileName({ sourceName: "mice.mp4", mode: "frame", inFrame: 42, outFrame: 42 })).toBe(
      "name-mice_index-42_type-frame_overlay.png",
    );
  });

  it("shares every entity with the plain extract it renders, differing only in the suffix", () => {
    const entities = { sourceName: "mice.mp4", mode: "frame" as const, inFrame: 42, outFrame: 42 };
    const plain = frameFileName(entities.sourceName, entities.inFrame);
    expect(overlayFileName(entities)).toBe(plain.replace("_image.png", "_overlay.png"));
  });
});

describe("bundleFileName", () => {
  it("names the saved bundle after the selection it holds", () => {
    expect(bundleFileName({ sourceName: "mice.mp4", mode: "snippet", inFrame: 120, outFrame: 300 })).toBe(
      "name-mice_range-120+300_type-snippet_bundle.tar.gz",
    );
  });

  it("names a single frame's bundle the same way", () => {
    expect(bundleFileName({ sourceName: "mice.mp4", mode: "frame", inFrame: 42, outFrame: 42 })).toBe(
      "name-mice_index-42_type-frame_bundle.tar.gz",
    );
  });
});

describe("extractClip, on a streamed source", () => {
  function streamingBackend() {
    return {
      width: 320,
      height: 240,
      extractRange: vi.fn(() => Promise.resolve({ blob: new Blob(["clip"], { type: "video/mp4" }), transcoded: true, start: 20, end: 25 })),
    } as unknown as StreamingVideoBackend;
  }

  const selection = { sourceUrl: "https://example.test/v.mp4", sourceName: "v.mp4", lo: 600, hi: 749, fps: 30 };

  it("cuts the selection out of the stream, without ever loading ffmpeg", async () => {
    ffmpeg.loaded = 0;
    const backend = streamingBackend();
    const media = await extractClip({ ...selection, sourceFile: null, backend });
    expect(ffmpeg.loaded).toBe(0);
    expect(backend.extractRange).toHaveBeenCalledWith(600, 749, expect.objectContaining({ precise: true }));
    expect(media.filename).toBe("name-v_range-600+749_type-snippet_video.mp4");
    expect(media.mime).toBe("video/mp4");
  });

  it("records how the cut was made, for the provenance sidecar", async () => {
    const media = await extractClip({ ...selection, sourceFile: null, backend: streamingBackend() });
    expect(media.encoding).toContain("20.000s–25.000s");
    expect(media.encoding).toContain("re-encoded");
    expect(media.encoding).toContain("audio dropped");
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

describe("extractClip, on a source ffmpeg had to convert before it would open", () => {
  /** ffmpeg only ever reads the bytes out of the source, and jsdom's File cannot hand them over. */
  const bytes = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as File;

  function stubFfmpeg(): void {
    ffmpeg.instance = {
      writeFile: vi.fn(() => Promise.resolve()),
      exec: vi.fn(() => Promise.resolve(0)),
      readFile: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
      deleteFile: vi.fn(() => Promise.resolve()),
    };
  }

  it("records the conversion ahead of the trim, so the provenance names every command the frames passed through", async () => {
    stubFfmpeg();
    const media = await extractClip({
      sourceFile: bytes,
      sourceUrl: null,
      sourceName: "mice.avi",
      sourcePreparation: "ffmpeg -i source.avi converted.mp4",
      lo: 0,
      hi: 29,
      fps: 30,
    });
    expect(media.encoding).toBe("ffmpeg -i source.avi converted.mp4, then ffmpeg -i in.mp4 clip.mp4");
  });

  it("says only what ffmpeg did when the source opened as it came", async () => {
    stubFfmpeg();
    const media = await extractClip({
      sourceFile: bytes,
      sourceUrl: null,
      sourceName: "mice.mp4",
      lo: 0,
      hi: 29,
      fps: 30,
    });
    expect(media.encoding).toBe("ffmpeg -i in.mp4 clip.mp4");
  });
});
