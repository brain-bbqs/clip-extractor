import { describe, expect, it } from "vitest";
import {
  buildGeneratedByEntry,
  freshDerivativesDescription,
  freshRootDescription,
  freshSourcedataDescription,
  mergeGeneratedBy,
  type GeneratedBySourceVideo,
} from "../../src/lib/generatedBy";

const createdAt = new Date("2026-08-10T01:23:56.482Z");

const video: GeneratedBySourceVideo = {
  filename: "mice.mp4",
  url: null,
  size_bytes: 4096,
  checksum: { algorithm: "dandi:dandi-etag", value: `${"a".repeat(32)}-1` },
  checksum_unavailable: null,
  fps: 30,
  width: 640,
  height: 480,
  num_frames: 900,
};

describe("buildGeneratedByEntry", () => {
  it("names the tool and a real semver version", () => {
    const entry = buildGeneratedByEntry();
    expect(entry.Name).toBe("clip-extractor");
    expect(entry.Version).toMatch(/^\d+\.\d+\.\d+/);
    expect(entry.CodeURL).toBe("https://github.com/brain-bbqs/clip-extractor");
    expect(entry.SourceVideo).toBeUndefined();
  });

  it("carries the source video when given one", () => {
    expect(buildGeneratedByEntry(video).SourceVideo).toEqual(video);
  });
});

describe("freshRootDescription / freshDerivativesDescription", () => {
  it("names the root after the delivery that created it, as a study", () => {
    expect(freshRootDescription("snippet", createdAt)).toEqual({
      Name: "Snippet extracted using the Clip Extractor on 2026-08-10T01:23:56.482Z",
      BIDSVersion: expect.any(String),
      DatasetType: "study",
    });
  });

  it("names a frame delivery the same way", () => {
    expect(freshRootDescription("frame", createdAt).Name).toBe("Frame extracted using the Clip Extractor on 2026-08-10T01:23:56.482Z");
  });

  it("names the pipeline's own derivative dataset, matching the study's own name with a suffix", () => {
    const doc = freshDerivativesDescription("snippet", createdAt);
    expect(doc.DatasetType).toBe("derivative");
    expect(doc.Name).toBe(`${freshRootDescription("snippet", createdAt).Name} (Extracted)`);
  });

  it("names sourcedata/rawbids's own the same way, with its own suffix", () => {
    const doc = freshSourcedataDescription("snippet", createdAt);
    expect(doc.DatasetType).toBe("raw");
    expect(doc.Name).toBe(`${freshRootDescription("snippet", createdAt).Name} (Original)`);
  });

  it("omits SourceDatasets when nothing is known about the source video", () => {
    expect(freshDerivativesDescription("snippet", createdAt).SourceDatasets).toBeUndefined();
  });

  it("names the source by URL when it was streamed from one", () => {
    const doc = freshDerivativesDescription("snippet", createdAt, { ...video, url: "https://api.test/assets/1/download/" });
    expect(doc.SourceDatasets).toEqual([
      { URL: "https://api.test/assets/1/download/", Filename: video.filename, Checksum: video.checksum },
    ]);
  });

  it("omits URL but still names the file and its checksum for a local file", () => {
    const doc = freshDerivativesDescription("snippet", createdAt, video);
    expect(doc.SourceDatasets).toEqual([{ Filename: video.filename, Checksum: video.checksum }]);
  });
});

describe("mergeGeneratedBy", () => {
  const entry = buildGeneratedByEntry(video);

  it("creates the fallback fresh, with just this entry, when nothing exists yet", () => {
    const doc = mergeGeneratedBy(null, entry, freshRootDescription("snippet", createdAt));
    expect(doc).toEqual({ ...freshRootDescription("snippet", createdAt), GeneratedBy: [entry] });
  });

  it("appends to an existing file's GeneratedBy, leaving everything else in it untouched", () => {
    const other = { Name: "clip-extractor", Version: "0.0.1" };
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [other], License: "CC0-1.0" };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("snippet", createdAt));
    expect(doc).toEqual({ ...existing, GeneratedBy: [other, entry] });
  });

  it("does not duplicate an entry for the same tool at the same version and the same source video", () => {
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [entry] };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("snippet", createdAt));
    expect(doc.GeneratedBy).toEqual([entry]);
  });

  it("adds a second entry for a different version of the same tool", () => {
    const older = { ...entry, Version: "0.0.1" };
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [older] };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("snippet", createdAt));
    expect(doc.GeneratedBy).toEqual([older, entry]);
  });

  it("adds a second entry for a different source video at the same tool version, rather than collapsing them", () => {
    const otherVideo = buildGeneratedByEntry({
      ...video,
      filename: "gerbil.mp4",
      checksum: { algorithm: "dandi:dandi-etag", value: `${"b".repeat(32)}-1` },
    });
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [entry] };
    const doc = mergeGeneratedBy(existing, otherVideo, freshRootDescription("snippet", createdAt));
    expect(doc.GeneratedBy).toEqual([entry, otherVideo]);
  });
});
