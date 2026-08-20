import { describe, expect, it } from "vitest";
import { buildGeneratedByEntry, freshDerivativesDescription, freshRootDescription, mergeGeneratedBy } from "../../src/lib/generatedBy";

describe("buildGeneratedByEntry", () => {
  it("names the tool and a real semver version", () => {
    const entry = buildGeneratedByEntry();
    expect(entry.Name).toBe("clip-extractor");
    expect(entry.Version).toMatch(/^\d+\.\d+\.\d+/);
    expect(entry.CodeURL).toBe("https://github.com/brain-bbqs/clip-extractor");
  });
});

describe("freshRootDescription / freshDerivativesDescription", () => {
  it("names the dataset itself, as raw", () => {
    expect(freshRootDescription("000123")).toEqual({ Name: "000123", BIDSVersion: expect.any(String), DatasetType: "raw" });
  });

  it("names the pipeline's own derivative dataset, pointing back at the dandiset", () => {
    const doc = freshDerivativesDescription("000123");
    expect(doc.DatasetType).toBe("derivative");
    expect(doc.Name).toContain("000123");
    expect(doc.SourceDatasets).toEqual([{ URL: "." }]);
  });
});

describe("mergeGeneratedBy", () => {
  const entry = buildGeneratedByEntry();

  it("creates the fallback fresh, with just this entry, when nothing exists yet", () => {
    const doc = mergeGeneratedBy(null, entry, freshRootDescription("000123"));
    expect(doc).toEqual({ Name: "000123", BIDSVersion: expect.any(String), DatasetType: "raw", GeneratedBy: [entry] });
  });

  it("appends to an existing file's GeneratedBy, leaving everything else in it untouched", () => {
    const other = { Name: "clip-extractor", Version: "0.0.1" };
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "raw" as const, GeneratedBy: [other], License: "CC0-1.0" };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("000123"));
    expect(doc).toEqual({ ...existing, GeneratedBy: [other, entry] });
  });

  it("does not duplicate an entry for the same tool at the same version", () => {
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "raw" as const, GeneratedBy: [entry] };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("000123"));
    expect(doc.GeneratedBy).toEqual([entry]);
  });

  it("adds a second entry for a different version of the same tool", () => {
    const older = { ...entry, Version: "0.0.1" };
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "raw" as const, GeneratedBy: [older] };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("000123"));
    expect(doc.GeneratedBy).toEqual([older, entry]);
  });
});
