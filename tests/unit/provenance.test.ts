import { describe, expect, it } from "vitest";
import { PROVENANCE_FORMAT, buildProvenance, type ProvenanceInput } from "../../src/lib/provenance";

const base: ProvenanceInput = {
  createdAt: new Date("2026-08-10T01:23:56.000Z"),
  pageUrl: "https://clip-extractor.brain-bbqs.org/",
  user: { username: "ada-lovelace", name: "Ada Lovelace" },
  api: "https://api-dandi.emberarchive.org/api",
  dandisetId: "000123",
  directory: "sourcedata/raw/clip-extractor/2026-08-10T01-23-56Z_snippet",
  mode: "snippet",
  fps: 30,
  width: 640,
  height: 480,
  totalFrames: 900,
  inFrame: 120,
  outFrame: 149,
  source: {
    filename: "mice.mp4",
    url: null,
    sizeBytes: 4096,
    checksum: `${"a".repeat(32)}-1`,
    checksumUnavailable: null,
    uploaded: true,
    assetPath: "sourcedata/raw/clip-extractor/2026-08-10T01-23-56Z_snippet/mice.mp4",
  },
  extracted: {
    filename: "name-mice_range-120+149_type-snippet_video.mp4",
    assetPath: "sourcedata/raw/clip-extractor/2026-08-10T01-23-56Z_snippet/name-mice_range-120+149_type-snippet_video.mp4",
    mediaType: "video/mp4",
    sizeBytes: 2048,
    checksum: `${"b".repeat(32)}-1`,
    encoding: "ffmpeg -i in.mp4 -vf trim=start_frame=120:end_frame=150 out.mp4",
  },
  overlay: null,
  annotations: null,
};

describe("buildProvenance", () => {
  it("records the format, timestamp, tool version, and uploader", () => {
    const doc = buildProvenance(base);
    expect(doc.format).toBe(PROVENANCE_FORMAT);
    expect(doc.created_at).toBe("2026-08-10T01:23:56.000Z");
    expect(doc.tool.name).toBe("clip-extractor");
    expect(doc.tool.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(doc.uploaded_by).toEqual({ username: "ada-lovelace", name: "Ada Lovelace" });
  });

  it("records the destination dataset and directory", () => {
    expect(buildProvenance(base).destination).toEqual({
      api: "https://api-dandi.emberarchive.org/api",
      dandiset_id: "000123",
      directory: "sourcedata/raw/clip-extractor/2026-08-10T01-23-56Z_snippet",
    });
  });

  it("derives the selection's frame count and duration from the inclusive bounds", () => {
    expect(buildProvenance(base).selection).toEqual({
      mode: "snippet",
      in_frame: 120,
      out_frame: 149,
      num_frames: 30,
      duration_seconds: 1,
    });
  });

  it("treats a single frame as a one-frame selection", () => {
    const doc = buildProvenance({ ...base, mode: "frame", inFrame: 300, outFrame: 300 });
    expect(doc.selection).toEqual({ mode: "frame", in_frame: 300, out_frame: 300, num_frames: 1, duration_seconds: 1 / 30 });
  });

  it("labels the checksum with DANDI's own digest identifier on both files", () => {
    const doc = buildProvenance(base);
    expect(doc.source_video.checksum).toEqual({ algorithm: "dandi:dandi-etag", value: `${"a".repeat(32)}-1` });
    expect(doc.extracted.checksum).toEqual({ algorithm: "dandi:dandi-etag", value: `${"b".repeat(32)}-1` });
  });

  it("still records the original's name and checksum when the original was not uploaded", () => {
    const doc = buildProvenance({
      ...base,
      source: { ...base.source, uploaded: false, assetPath: null },
    });
    expect(doc.source_video.uploaded).toBe(false);
    expect(doc.source_video.asset_path).toBeNull();
    expect(doc.source_video.filename).toBe("mice.mp4");
    expect(doc.source_video.checksum?.value).toBe(`${"a".repeat(32)}-1`);
    expect(doc.source_video.checksum_unavailable).toBeNull();
  });

  it("explains a missing checksum for a streamed source", () => {
    const doc = buildProvenance({
      ...base,
      source: {
        filename: "remote.mp4",
        url: "https://api-dandi.emberarchive.org/assets/remote.mp4",
        sizeBytes: null,
        checksum: null,
        checksumUnavailable: "streamed",
        uploaded: false,
        assetPath: null,
      },
    });
    expect(doc.source_video.checksum).toBeNull();
    expect(doc.source_video.checksum_unavailable).toBe("streamed");
    expect(doc.source_video.url).toBe("https://api-dandi.emberarchive.org/assets/remote.mp4");
  });

  it("carries the video properties and the command that produced the extract", () => {
    const doc = buildProvenance(base);
    expect(doc.source_video.fps).toBe(30);
    expect(doc.source_video.width).toBe(640);
    expect(doc.source_video.height).toBe(480);
    expect(doc.source_video.num_frames).toBe(900);
    expect(doc.extracted.encoding).toContain("trim=start_frame=120");
  });

  it("records no annotations block when no .slp was loaded", () => {
    expect(buildProvenance(base).annotations).toBeNull();
  });

  it("records no overlay when there was nothing to draw", () => {
    expect(buildProvenance(base).overlay).toBeNull();
  });

  it("records the rendered overlay as its own file", () => {
    const doc = buildProvenance({
      ...base,
      overlay: {
        filename: "name-mice_range-120+149_type-snippet_desc-overlay_video.mp4",
        assetPath: "sourcedata/raw/clip-extractor/stamp/name-mice_range-120+149_type-snippet_desc-overlay_video.mp4",
        mediaType: "video/mp4",
        sizeBytes: 4096,
        checksum: `${"d".repeat(32)}-1`,
        encoding: "ffmpeg -framerate 30.0000 -i ov%06d.png -c:v libx264 overlay.mp4",
      },
    });
    expect(doc.overlay).toEqual({
      filename: "name-mice_range-120+149_type-snippet_desc-overlay_video.mp4",
      asset_path: "sourcedata/raw/clip-extractor/stamp/name-mice_range-120+149_type-snippet_desc-overlay_video.mp4",
      media_type: "video/mp4",
      size_bytes: 4096,
      checksum: { algorithm: "dandi:dandi-etag", value: `${"d".repeat(32)}-1` },
      encoding: "ffmpeg -framerate 30.0000 -i ov%06d.png -c:v libx264 overlay.mp4",
    });
  });

  it("names, checksums and locates an uploaded .slp alongside its counts", () => {
    const doc = buildProvenance({
      ...base,
      annotations: {
        filename: "mice.tracked.slp",
        checksum: `${"c".repeat(32)}-1`,
        uploaded: true,
        assetPath: "sourcedata/raw/clip-extractor/stamp/mice.tracked.slp",
        skeletonNodeCount: 5,
        trackCount: 2,
        labeledFramesInSelection: 12,
      },
    });
    expect(doc.annotations).toEqual({
      filename: "mice.tracked.slp",
      checksum: { algorithm: "dandi:dandi-etag", value: `${"c".repeat(32)}-1` },
      uploaded: true,
      asset_path: "sourcedata/raw/clip-extractor/stamp/mice.tracked.slp",
      skeleton_node_count: 5,
      track_count: 2,
      labeled_frames_in_selection: 12,
    });
  });

  it("still records the .slp's checksum when it was not uploaded", () => {
    const doc = buildProvenance({
      ...base,
      annotations: {
        filename: "mice.tracked.slp",
        checksum: `${"c".repeat(32)}-1`,
        uploaded: false,
        assetPath: null,
        skeletonNodeCount: 5,
        trackCount: 2,
        labeledFramesInSelection: 12,
      },
    });
    expect(doc.annotations?.uploaded).toBe(false);
    expect(doc.annotations?.asset_path).toBeNull();
    expect(doc.annotations?.checksum?.value).toBe(`${"c".repeat(32)}-1`);
  });

  it("serializes to JSON without losing an unknown uploader", () => {
    const doc = buildProvenance({ ...base, user: null });
    expect(JSON.parse(JSON.stringify(doc)).uploaded_by).toBeNull();
  });
});
