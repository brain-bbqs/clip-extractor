import { describe, expect, it } from "vitest";
import {
  PROVENANCE_FORMAT,
  buildBehSidecar,
  buildCompanionSidecar,
  buildGeneratedBySourceVideo,
  buildProvenance,
  imageTechnicalFields,
  videoTechnicalFields,
  type ProvenanceInput,
} from "../../src/lib/provenance";

const base: ProvenanceInput = {
  createdAt: new Date("2026-08-10T01:23:56.000Z"),
  pageUrl: "https://clip-extractor.brain-bbqs.org/",
  description: null,
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

  it("names only the directory for a bundle saved locally, which has no archive behind it", () => {
    const doc = buildProvenance({ ...base, api: null, dandisetId: null, user: null });
    expect(doc.destination).toEqual({
      api: null,
      dandiset_id: null,
      directory: "sourcedata/raw/clip-extractor/2026-08-10T01-23-56Z_snippet",
    });
    expect(doc.uploaded_by).toBeNull();
  });

  it("carries the description written for this selection", () => {
    expect(buildProvenance({ ...base, description: "The tracker swaps the two mice at frame 130." }).description).toBe(
      "The tracker swaps the two mice at frame 130.",
    );
  });

  it("trims a description, and treats a blank one as none at all", () => {
    expect(buildProvenance({ ...base, description: "  Lost the tail node here.\n" }).description).toBe("Lost the tail node here.");
    expect(buildProvenance({ ...base, description: "   \n " }).description).toBeNull();
    expect(buildProvenance(base).description).toBeNull();
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
        filename: "name-mice_range-120+149_type-snippet_overlay.mp4",
        assetPath: "sourcedata/raw/clip-extractor/stamp/name-mice_range-120+149_type-snippet_overlay.mp4",
        mediaType: "video/mp4",
        sizeBytes: 4096,
        checksum: `${"d".repeat(32)}-1`,
        encoding: "ffmpeg -framerate 30.0000 -i ov%06d.png -c:v libx264 overlay.mp4",
      },
    });
    expect(doc.overlay).toEqual({
      filename: "name-mice_range-120+149_type-snippet_overlay.mp4",
      asset_path: "sourcedata/raw/clip-extractor/stamp/name-mice_range-120+149_type-snippet_overlay.mp4",
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

  it("records no blur when nothing was blurred", () => {
    expect(buildProvenance(base).blur).toBeNull();
    expect(buildProvenance({ ...base, blur: [] }).blur).toBeNull();
  });

  it("records what was blurred out of every file, in source pixels", () => {
    const doc = buildProvenance({
      ...base,
      blur: [
        { x: 320, y: 240, radius: 60 },
        { x: 100, y: 50, radius: 30 },
      ],
      blurSigma: 20,
    });
    expect(doc.blur).toEqual({
      method: "gaussian",
      sigma: 20,
      regions: [
        { x: 320, y: 240, radius: 60 },
        { x: 100, y: 50, radius: 30 },
      ],
    });
  });

  it("copies the regions, so a later edit cannot rewrite a record already written", () => {
    const regions = [{ x: 10, y: 20, radius: 30 }];
    const doc = buildProvenance({ ...base, blur: regions, blurSigma: 10 });
    regions[0].x = 999;
    expect(doc.blur?.regions[0].x).toBe(10);
  });

  it("serializes to JSON without losing an unknown uploader", () => {
    const doc = buildProvenance({ ...base, user: null });
    expect(JSON.parse(JSON.stringify(doc)).uploaded_by).toBeNull();
  });
});

describe("videoTechnicalFields / imageTechnicalFields", () => {
  it("derives the recording's duration from fps and frame count", () => {
    expect(videoTechnicalFields(30, 640, 480, 90)).toEqual({
      RecordingDuration: 3,
      VideoFrameRate: 30,
      VideoFrameCount: 90,
      ImageWidth: 640,
      ImageHeight: 480,
    });
  });

  it("never divides by zero for an fps-less source", () => {
    expect(videoTechnicalFields(0, 640, 480, 90).RecordingDuration).toBe(0);
  });

  it("carries only width and height for a still image", () => {
    expect(imageTechnicalFields(640, 480)).toEqual({ ImageWidth: 640, ImageHeight: 480 });
  });
});

describe("buildGeneratedBySourceVideo", () => {
  it("matches buildProvenance's own source_video block, in GeneratedByEntry's shape", () => {
    const sourceVideo = buildGeneratedBySourceVideo(base);
    const provenance = buildProvenance(base);
    expect(sourceVideo).toEqual({
      filename: provenance.source_video.filename,
      url: provenance.source_video.url,
      size_bytes: provenance.source_video.size_bytes,
      checksum: provenance.source_video.checksum,
      checksum_unavailable: provenance.source_video.checksum_unavailable,
      fps: provenance.source_video.fps,
      width: provenance.source_video.width,
      height: provenance.source_video.height,
      num_frames: provenance.source_video.num_frames,
    });
  });
});

describe("buildBehSidecar", () => {
  const technical = videoTechnicalFields(30, 640, 480, 30);

  it("puts the description and the technical fields at the top level, alongside GeneratedBy", () => {
    const sidecar = buildBehSidecar({ ...base, description: "Two mice groom each other here." }, technical);
    expect(sidecar.Description).toBe("Two mice groom each other here.");
    expect(sidecar.RecordingDuration).toBe(1);
    expect((sidecar.GeneratedBy as { Name: string }[])[0].Name).toBe("clip-extractor");
  });

  it("nests this app's full record under its own key, so nothing the old provenance file held is lost", () => {
    const sidecar = buildBehSidecar(base, technical);
    const nested = sidecar["clip-extractor"] as { format: string };
    expect(nested.format).toBe(PROVENANCE_FORMAT);
  });
});

describe("buildCompanionSidecar", () => {
  it("names what it is, points back at its source, and skips GeneratedBy for a plain copy", () => {
    const sidecar = buildCompanionSidecar({
      description: "The untouched original.",
      technical: imageTechnicalFields(640, 480),
      sources: ["sourcedata/sub-1/beh/mice.mp4"],
      generatedByTool: false,
    });
    expect(sidecar).toEqual({
      Description: "The untouched original.",
      ImageWidth: 640,
      ImageHeight: 480,
      Sources: ["sourcedata/sub-1/beh/mice.mp4"],
    });
  });

  it("carries GeneratedBy for something this tool actually rendered", () => {
    const sidecar = buildCompanionSidecar({
      description: "The pose overlay.",
      technical: imageTechnicalFields(640, 480),
      sources: ["derivatives/clip-extractor/sub-1/beh/sub-1_recording-1_video.mp4"],
      generatedByTool: true,
    });
    expect((sidecar.GeneratedBy as { Name: string }[])[0].Name).toBe("clip-extractor");
  });

  it("omits Sources entirely for the untouched source video, which has no upstream to name", () => {
    const sidecar = buildCompanionSidecar({
      description: "The source video this selection was clipped from.",
      technical: imageTechnicalFields(640, 480),
      sources: [],
      generatedByTool: false,
    });
    expect(sidecar).not.toHaveProperty("Sources");
  });
});
