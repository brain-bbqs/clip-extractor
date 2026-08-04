import { describe, expect, it } from "vitest";
import { blobToBase64, buildPayload, parseHeaders, targetUrl } from "../../src/lib/payload";
import type { AnnotationsDocument, Extracted, PayloadMetadata } from "../../src/lib/types";

const meta: PayloadMetadata = {
  source: "video.mp4",
  source_url: null,
  original_filename: "video.mp4",
  author: "cody",
  in_frame: 0,
  out_frame: 9,
  num_frames: 10,
  fps: 30,
  width: 640,
  height: 480,
  media_kind: "clip",
  media_mime: "video/mp4",
  frame_count: 1,
  has_annotations: false,
  created_at: "2026-01-01T00:00:00.000Z",
};

const annotations: AnnotationsDocument = {
  format: "sleap-clip-annotations/v1",
  clip: {
    source: "video.mp4",
    source_url: null,
    original_filename: "video.mp4",
    author: "cody",
    in_frame: 0,
    out_frame: 9,
    num_frames: 10,
    fps: 30,
    width: 640,
    height: 480,
    extracted_at: "2026-01-01T00:00:00.000Z",
  },
  skeleton: null,
  tracks: [],
  labeled_frame_count: 0,
  frames: [],
};

const clipExtracted: Extracted = { kind: "clip", blob: new Blob(["fake-mp4"], { type: "video/mp4" }), name: "clip.mp4", mime: "video/mp4" };
const framesExtracted: Extracted = {
  kind: "frames",
  frames: [{ source_frame: 0, clip_frame: 0, blob: new Blob(["fake-png"], { type: "image/png" }) }],
  ext: "png",
  mime: "image/png",
  name: "video_frames",
};

describe("blobToBase64", () => {
  it("round-trips a blob's bytes as base64", async () => {
    const b64 = await blobToBase64(new Blob(["hello"]));
    expect(atob(b64)).toBe("hello");
  });
});

describe("buildPayload", () => {
  it("builds the Pozu /clips JSON body for a clip", async () => {
    const p = await buildPayload({ extracted: clipExtracted, pkg: "pozu", meta, annotations, filename: "video.mp4", author: "cody" });
    expect(p.type).toBe("pozu");
    if (p.type !== "pozu") throw new Error("expected pozu");
    expect(p.obj.filename).toBe("video.mp4");
    expect(p.obj.author).toBe("cody");
    expect(p.contentType).toBe("application/json");
  });

  it("rejects frame output for the Pozu packaging", async () => {
    await expect(
      buildPayload({ extracted: framesExtracted, pkg: "pozu", meta, annotations, filename: "video.mp4", author: "" }),
    ).rejects.toThrow(/MP4 clip only/);
  });

  it("builds a multipart body with clip + metadata + annotations parts", async () => {
    const p = await buildPayload({ extracted: clipExtracted, pkg: "multipart", meta, annotations, filename: "video.mp4", author: "" });
    expect(p.type).toBe("multipart");
    if (p.type !== "multipart") throw new Error("expected multipart");
    expect(p.body.get("clip")).toBeInstanceOf(File);
    expect(p.body.get("metadata")).toBeInstanceOf(File);
    expect(p.body.get("annotations")).toBeInstanceOf(File);
  });

  it("builds a multipart body with one frames part per image", async () => {
    const p = await buildPayload({ extracted: framesExtracted, pkg: "multipart", meta, annotations, filename: "video.mp4", author: "" });
    if (p.type !== "multipart") throw new Error("expected multipart");
    expect(p.body.getAll("frames")).toHaveLength(1);
  });

  it("builds a generic JSON+base64 body", async () => {
    const p = await buildPayload({ extracted: clipExtracted, pkg: "json", meta, annotations, filename: "video.mp4", author: "" });
    expect(p.type).toBe("json");
    if (p.type !== "json") throw new Error("expected json");
    expect(p.obj.media.kind).toBe("clip");
    if (p.obj.media.kind !== "clip") throw new Error("expected clip media");
    expect(p.obj.media.data_base64.length).toBeGreaterThan(0);
  });
});

describe("parseHeaders", () => {
  it("returns an empty object for blank input", () => {
    expect(parseHeaders("  ")).toEqual({});
  });

  it("parses a JSON object", () => {
    expect(parseHeaders('{"Authorization": "Bearer x"}')).toEqual({ Authorization: "Bearer x" });
  });

  it("throws a friendly error on invalid JSON", () => {
    expect(() => parseHeaders("not json")).toThrow("Headers must be valid JSON");
  });
});

describe("targetUrl", () => {
  it("returns null with no endpoint set", () => {
    expect(targetUrl("  ", true, "https://proxy/")).toBeNull();
  });

  it("routes through the proxy when enabled", () => {
    expect(targetUrl("https://api.example/clips", true, "https://proxy/")).toBe("https://proxy/https://api.example/clips");
  });

  it("posts directly when the proxy is disabled", () => {
    expect(targetUrl("https://api.example/clips", false, "https://proxy/")).toBe("https://api.example/clips");
  });
});
