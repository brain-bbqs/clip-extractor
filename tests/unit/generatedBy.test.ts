import { describe, expect, it } from "vitest";
import {
  buildGeneratedByEntry,
  freshDerivativesDescription,
  freshRootDescription,
  freshSourcedataDescription,
  mergeAuthor,
  mergeDatasetLinks,
  mergeGeneratedBy,
  mergeSourceDataset,
  type SourceDatasetEntry,
} from "../../src/lib/generatedBy";

const video: SourceDatasetEntry = {
  URL: "https://api-dandi.emberarchive.org/api/dandisets/000479",
  Path: "sub-01/ses-02/beh/mice.mp4",
};

describe("buildGeneratedByEntry", () => {
  it("names the tool and a real semver version", () => {
    const entry = buildGeneratedByEntry();
    expect(entry.Name).toBe("clip-extractor");
    expect(entry.Version).toMatch(/^\d+\.\d+\.\d+/);
    expect(entry.CodeURL).toBe("https://github.com/brain-bbqs/clip-extractor");
  });

  it("orders its keys Name, Description, then the version-y fields — object literals preserve this through JSON.stringify", () => {
    expect(Object.keys(buildGeneratedByEntry())).toEqual(["Name", "Description", "Version", "CodeURL"]);
  });
});

describe("freshRootDescription / freshDerivativesDescription", () => {
  it("names the root after the delivery that created it, as a study", () => {
    expect(freshRootDescription("snippet")).toEqual({
      Name: "Snippet extracted using the Clip Extractor",
      BIDSVersion: expect.any(String),
      DatasetType: "study",
    });
  });

  it("names a frame delivery the same way", () => {
    expect(freshRootDescription("frame").Name).toBe("Frame extracted using the Clip Extractor");
  });

  it("names the pipeline's own derivative dataset, matching the study's own name with a suffix", () => {
    const doc = freshDerivativesDescription("snippet");
    expect(doc.DatasetType).toBe("derivative");
    expect(doc.Name).toBe(`${freshRootDescription("snippet").Name} (Extracted)`);
  });

  it("names sourcedata/rawbids's own the same way, with its own suffix", () => {
    const doc = freshSourcedataDescription("snippet");
    expect(doc.DatasetType).toBe("raw");
    expect(doc.Name).toBe(`${freshRootDescription("snippet").Name} (Original)`);
  });

  it("has no SourceDatasets of its own — a delivery folds its own entry in afterwards", () => {
    expect(freshDerivativesDescription("snippet").SourceDatasets).toBeUndefined();
  });
});

describe("mergeGeneratedBy", () => {
  const entry = buildGeneratedByEntry();

  it("creates the fallback fresh, with just this entry, when nothing exists yet", () => {
    const doc = mergeGeneratedBy(null, entry, freshRootDescription("snippet"));
    expect(doc).toEqual({ ...freshRootDescription("snippet"), GeneratedBy: [entry] });
  });

  it("appends to an existing file's GeneratedBy, leaving everything else in it untouched", () => {
    const other = { Name: "clip-extractor", Version: "0.0.1" };
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [other], License: "CC0-1.0" };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("snippet"));
    expect(doc).toEqual({ ...existing, GeneratedBy: [other, entry] });
  });

  it("does not duplicate an entry for the same tool at the same version", () => {
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [entry] };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("snippet"));
    expect(doc.GeneratedBy).toEqual([entry]);
  });

  it("does not duplicate it even for a second delivery of a different video, at the same tool version", () => {
    // GeneratedBy only ever names the tool and its version — which videos it ran against is
    // SourceDatasets' own job (see the mergeSourceDataset suite below), so a second video does not
    // get a second GeneratedBy entry the way it gets a second SourceDatasets one.
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [entry] };
    const doc = mergeGeneratedBy(existing, buildGeneratedByEntry(), freshRootDescription("snippet"));
    expect(doc.GeneratedBy).toEqual([entry]);
  });

  it("adds a second entry for a different version of the same tool", () => {
    const older = { ...entry, Version: "0.0.1" };
    const existing = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [older] };
    const doc = mergeGeneratedBy(existing, entry, freshRootDescription("snippet"));
    expect(doc.GeneratedBy).toEqual([older, entry]);
  });
});

describe("mergeSourceDataset", () => {
  const doc = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "derivative" as const };

  it("adds the entry when there is none yet", () => {
    expect(mergeSourceDataset(doc, video)).toEqual({ ...doc, SourceDatasets: [video] });
  });

  it("leaves the document untouched — not even adding the field — for an empty entry", () => {
    expect(mergeSourceDataset(doc, {})).toBe(doc);
    expect(mergeSourceDataset(doc, null)).toBe(doc);
  });

  it("does not duplicate the same video delivered twice", () => {
    const withVideo = { ...doc, SourceDatasets: [video] };
    expect(mergeSourceDataset(withVideo, video)).toBe(withVideo);
  });

  it("adds a second entry for a different video, rather than collapsing them", () => {
    const otherVideo: SourceDatasetEntry = {
      URL: "https://api-dandi.emberarchive.org/api/dandisets/000480",
      Path: "sub-02/ses-01/beh/gerbil.mp4",
    };
    const withVideo = { ...doc, SourceDatasets: [video] };
    expect(mergeSourceDataset(withVideo, otherVideo)).toEqual({ ...doc, SourceDatasets: [video, otherVideo] });
  });
});

describe("mergeAuthor", () => {
  const doc = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const };

  it("leaves the document untouched — not even adding the field — when nobody is signed in", () => {
    expect(mergeAuthor(doc, null)).toBe(doc);
  });

  it("credits the signed-in username", () => {
    expect(mergeAuthor(doc, "cody")).toEqual({ ...doc, Authors: ["cody"] });
  });

  it("appends to whoever is already credited, rather than replacing them", () => {
    const withAuthor = { ...doc, Authors: ["someone-else"] };
    expect(mergeAuthor(withAuthor, "cody")).toEqual({ ...doc, Authors: ["someone-else", "cody"] });
  });

  it("does not duplicate the same username credited twice", () => {
    const withAuthor = { ...doc, Authors: ["cody"] };
    expect(mergeAuthor(withAuthor, "cody")).toEqual(withAuthor);
  });
});

describe("mergeDatasetLinks", () => {
  const doc = { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "study" as const };

  it("adds the alias when there is none yet", () => {
    expect(mergeDatasetLinks(doc, "clip", "derivatives/clip-extractor")).toEqual({
      ...doc,
      DatasetLinks: { clip: "derivatives/clip-extractor" },
    });
  });

  it("adds a second alias beside whatever another pipeline already put there", () => {
    const withLinks = { ...doc, DatasetLinks: { phenotype: "phenotype/" } };
    expect(mergeDatasetLinks(withLinks, "clip", "derivatives/clip-extractor")).toEqual({
      ...doc,
      DatasetLinks: { phenotype: "phenotype/", clip: "derivatives/clip-extractor" },
    });
  });

  it("leaves the document untouched once the alias is already correct", () => {
    const withLink = { ...doc, DatasetLinks: { clip: "derivatives/clip-extractor" } };
    expect(mergeDatasetLinks(withLink, "clip", "derivatives/clip-extractor")).toBe(withLink);
  });

  it("corrects the alias in place if it somehow pointed somewhere else", () => {
    const withStaleLink = { ...doc, DatasetLinks: { clip: "derivatives/old-name" } };
    expect(mergeDatasetLinks(withStaleLink, "clip", "derivatives/clip-extractor")).toEqual({
      ...doc,
      DatasetLinks: { clip: "derivatives/clip-extractor" },
    });
  });
});
