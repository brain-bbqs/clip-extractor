import { describe, expect, it } from "vitest";
import {
  buildBehSidecar,
  buildCompanionSidecar,
  buildSourceDatasetEntry,
  imageTechnicalFields,
  videoTechnicalFields,
  type FileDigest,
  type ProvenanceInput,
} from "../../src/lib/provenance";

const digest: FileDigest = { md5: "1".repeat(32), dandiEtag: `${"a".repeat(32)}-1` };

const base: ProvenanceInput = {
  description: null,
  source: {
    filename: "mice.mp4",
    url: null,
    checksum: `${"a".repeat(32)}-1`,
  },
};

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

  it("omits every optional technical field when none was given", () => {
    const fields = videoTechnicalFields(30, 640, 480, 90);
    expect(fields).not.toHaveProperty("VideoCodec");
    expect(fields).not.toHaveProperty("VideoCodecRFC6381");
    expect(fields).not.toHaveProperty("ImagePixelFormat");
    expect(fields).not.toHaveProperty("ImageBitDepth");
  });

  it("carries whichever of codec, its RFC 6381 string, pixel format and bit depth are given", () => {
    const fields = videoTechnicalFields(30, 640, 480, 90, {
      codec: "h264",
      codecRFC6381: "avc1.640028",
      pixelFormat: "yuv420p",
      bitDepth: 8,
    });
    expect(fields.VideoCodec).toBe("h264");
    expect(fields.VideoCodecRFC6381).toBe("avc1.640028");
    expect(fields.ImagePixelFormat).toBe("yuv420p");
    expect(fields.ImageBitDepth).toBe(8);
  });

  it("carries only width and height for a still image", () => {
    expect(imageTechnicalFields(640, 480)).toEqual({ ImageWidth: 640, ImageHeight: 480 });
  });
});

describe("buildSourceDatasetEntry", () => {
  it("names the file and its checksum for a local file, with no URL", () => {
    expect(buildSourceDatasetEntry(base)).toEqual({
      Filename: "mice.mp4",
      Checksum: { algorithm: "dandi:dandi-etag", value: `${"a".repeat(32)}-1` },
    });
  });

  it("names the URL too, when the source was streamed from one", () => {
    const streamed: ProvenanceInput = { ...base, source: { ...base.source, url: "https://api.test/assets/1/download/" } };
    expect(buildSourceDatasetEntry(streamed)).toEqual({
      URL: "https://api.test/assets/1/download/",
      Filename: "mice.mp4",
      Checksum: { algorithm: "dandi:dandi-etag", value: `${"a".repeat(32)}-1` },
    });
  });

  it("omits Checksum when the source has none", () => {
    const noChecksum: ProvenanceInput = { ...base, source: { ...base.source, checksum: null } };
    expect(buildSourceDatasetEntry(noChecksum)).toEqual({ Filename: "mice.mp4" });
  });
});

describe("buildBehSidecar", () => {
  const technical = videoTechnicalFields(30, 640, 480, 30);

  it("puts the description at the top level, alongside GeneratedBy and Checksum — no nested record", () => {
    const sidecar = buildBehSidecar({ ...base, description: "Two mice groom each other here." }, technical, digest);
    expect(sidecar.Description).toBe("Two mice groom each other here.");
    expect((sidecar.GeneratedBy as { Name: string }[])[0].Name).toBe("clip-extractor");
    expect(sidecar).not.toHaveProperty("clip-extractor");
  });

  it("trims a description, and treats a blank one as none at all", () => {
    expect(buildBehSidecar({ ...base, description: "  Lost the tail node here.\n" }, technical, digest).Description).toBe(
      "Lost the tail node here.",
    );
    expect(buildBehSidecar({ ...base, description: "   \n " }, technical, digest).Description).toBeNull();
    expect(buildBehSidecar(base, technical, digest).Description).toBeNull();
  });

  it("names this file's own MD5 and dandi-etag under Checksum, SPDX-shaped", () => {
    const sidecar = buildBehSidecar(base, technical, digest);
    expect(sidecar.Checksum).toEqual([
      { ChecksumAlgorithm: "spdx:checksumAlgorithm_md5", ChecksumValue: digest.md5 },
      { ChecksumAlgorithm: "dandi:dandi-etag", ChecksumValue: digest.dandiEtag },
    ]);
  });

  it("groups BEP047's own technical keys together, last", () => {
    const sidecar = buildBehSidecar(base, technical, digest);
    const keys = Object.keys(sidecar);
    const technicalKeys = Object.keys(technical);
    expect(keys.slice(-technicalKeys.length)).toEqual(technicalKeys);
  });
});

describe("buildCompanionSidecar", () => {
  it("names what it is, points back at its source, and skips GeneratedBy for a plain copy", () => {
    const sidecar = buildCompanionSidecar({
      description: "The untouched original.",
      technical: imageTechnicalFields(640, 480),
      sources: ["sourcedata/sub-1/beh/mice.mp4"],
      generatedByTool: false,
      checksum: digest,
    });
    expect(sidecar).toEqual({
      Description: "The untouched original.",
      Sources: ["sourcedata/sub-1/beh/mice.mp4"],
      Checksum: [
        { ChecksumAlgorithm: "spdx:checksumAlgorithm_md5", ChecksumValue: digest.md5 },
        { ChecksumAlgorithm: "dandi:dandi-etag", ChecksumValue: digest.dandiEtag },
      ],
      ImageWidth: 640,
      ImageHeight: 480,
    });
  });

  it("carries GeneratedBy for something this tool actually rendered", () => {
    const sidecar = buildCompanionSidecar({
      description: "The pose overlay.",
      technical: imageTechnicalFields(640, 480),
      sources: ["derivatives/clip-extractor/sub-1/beh/sub-1_recording-1_video.mp4"],
      generatedByTool: true,
      checksum: digest,
    });
    expect((sidecar.GeneratedBy as { Name: string }[])[0].Name).toBe("clip-extractor");
  });

  it("omits Sources entirely for the untouched source video, which has no upstream to name", () => {
    const sidecar = buildCompanionSidecar({
      description: "The source video this selection was clipped from.",
      technical: imageTechnicalFields(640, 480),
      sources: [],
      generatedByTool: false,
      checksum: digest,
    });
    expect(sidecar).not.toHaveProperty("Sources");
  });

  it("omits Checksum entirely for a file BEP047 gives no checksum-worthy identity to, like a .slp", () => {
    const sidecar = buildCompanionSidecar({
      description: "SLEAP pose annotations.",
      sources: [],
      generatedByTool: false,
      checksum: null,
    });
    expect(sidecar).not.toHaveProperty("Checksum");
  });
});
