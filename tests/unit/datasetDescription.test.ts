import { describe, expect, it, vi } from "vitest";
import {
  DATASET_DESCRIPTION_PATH,
  DERIVATIVES_DESCRIPTION_PATH,
  SOURCEDATA_DESCRIPTION_PATH,
  mergedDatasetDescriptions,
  readExistingDatasetDescriptions,
} from "../../src/lib/datasetDescription";
import { buildGeneratedByEntry, type SourceDatasetEntry } from "../../src/lib/generatedBy";
import type { ArchiveConfig, Asset } from "../../src/lib/types";

const sourceDataset: SourceDatasetEntry = {
  URL: "https://api-dandi.emberarchive.org/api/dandisets/000479",
  Path: "sub-01/ses-02/beh/mice.mp4",
};

const cfg: ArchiveConfig = { api: "https://api.test/api", web: "https://web.test", accessToken: "tok", dandisetId: "000123" };

vi.mock("../../src/lib/upload", () => ({ findExistingAsset: vi.fn() }));
import { findExistingAsset } from "../../src/lib/upload";

describe("readExistingDatasetDescriptions", () => {
  it("reports all three files null when none is registered", async () => {
    vi.mocked(findExistingAsset).mockResolvedValue(null);
    await expect(readExistingDatasetDescriptions(cfg)).resolves.toEqual({ root: null, derivatives: null, sourcedata: null });
  });

  it("reads an existing file's content, not just that it exists", async () => {
    const rootDoc = { Name: "000123", BIDSVersion: "1.10.0", DatasetType: "raw" };
    vi.mocked(findExistingAsset).mockImplementation(async (_cfg, path) =>
      path === DATASET_DESCRIPTION_PATH ? ({ asset_id: "a1", path } as Asset) : null,
    );
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => rootDoc });
    try {
      await expect(readExistingDatasetDescriptions(cfg)).resolves.toEqual({ root: rootDoc, derivatives: null, sourcedata: null });
      expect(global.fetch).toHaveBeenCalledWith("https://api.test/api/assets/a1/download/", expect.anything());
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws rather than silently treating a failed read as not-registered", async () => {
    vi.mocked(findExistingAsset).mockResolvedValue({ asset_id: "a1", path: DATASET_DESCRIPTION_PATH } as Asset);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    try {
      await expect(readExistingDatasetDescriptions(cfg)).rejects.toThrow(/500/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("mergedDatasetDescriptions", () => {
  it("builds all three files fresh when none exists yet", () => {
    const entry = buildGeneratedByEntry();
    const { root, derivatives, sourcedata } = mergedDatasetDescriptions(
      { root: null, derivatives: null, sourcedata: null },
      entry,
      sourceDataset,
      "snippet",
      null,
    );
    // Named after this delivery, and DatasetType: "study" — this root organizes sourcedata/rawbids/
    // (raw) and derivatives/ (derived) together, per BIDS's own convention for that.
    expect(root).toEqual({
      Name: "Snippet extracted using the Clip Extractor",
      BIDSVersion: expect.any(String),
      DatasetType: "study",
      GeneratedBy: [entry],
      DatasetLinks: { clip: "derivatives/clip-extractor", source: "sourcedata/rawbids" },
    });
    expect(derivatives.DatasetType).toBe("derivative");
    expect(derivatives.GeneratedBy).toEqual([entry]);
    // Its own alias back the other way, so either file can be followed without spelling the other's
    // path out.
    expect(derivatives.DatasetLinks).toEqual({ raw: "../../sourcedata/rawbids" });
    // This delivery's own video, named on the derivatives file — nowhere else.
    expect(derivatives.SourceDatasets).toEqual([sourceDataset]);
    expect(root.SourceDatasets).toBeUndefined();
    // Its own DatasetType: "raw" too — sourcedata/rawbids/ is meant to validate as a complete raw
    // BIDS dataset by itself, independent of the dandiset it sits inside.
    expect(sourcedata.DatasetType).toBe("raw");
    expect(sourcedata.GeneratedBy).toEqual([entry]);
    // No signed-in visitor named, so nobody is credited.
    expect(root.Authors).toBeUndefined();
    // sourcedata/rawbids/ has nothing to link back to — it is the leaf, not the root or the
    // derivative naming where its content came from.
    expect(sourcedata.DatasetLinks).toBeUndefined();
  });

  it("folds into an existing set without disturbing another pipeline's entries", () => {
    const other = { Name: "other-tool", Version: "2.0.0" };
    const entry = buildGeneratedByEntry();
    const existing = {
      root: { Name: "My Study", BIDSVersion: "1.9.0", DatasetType: "study" as const, GeneratedBy: [other] },
      derivatives: null,
      sourcedata: null,
    };
    const { root } = mergedDatasetDescriptions(existing, entry, sourceDataset, "snippet", null);
    expect(root.GeneratedBy).toEqual([other, entry]);
    // Left as it was found, not renamed after this delivery.
    expect(root.Name).toBe("My Study");
  });

  it("accumulates a second video into SourceDatasets on a repeat delivery, rather than losing it", () => {
    const entry = buildGeneratedByEntry();
    const first = mergedDatasetDescriptions({ root: null, derivatives: null, sourcedata: null }, entry, sourceDataset, "snippet", null);
    const otherVideo: SourceDatasetEntry = {
      URL: "https://api-dandi.emberarchive.org/api/dandisets/000480",
      Path: "sub-02/ses-01/beh/gerbil.mp4",
    };
    const second = mergedDatasetDescriptions(
      { root: first.root, derivatives: first.derivatives, sourcedata: first.sourcedata },
      entry,
      otherVideo,
      "snippet",
      null,
    );
    expect(second.derivatives.SourceDatasets).toEqual([sourceDataset, otherVideo]);
    // GeneratedBy itself is still just the one entry — the same tool, the same version.
    expect(second.derivatives.GeneratedBy).toEqual([entry]);
  });

  it("credits the signed-in username on all three files when one is given", () => {
    const entry = buildGeneratedByEntry();
    const { root, derivatives, sourcedata } = mergedDatasetDescriptions(
      { root: null, derivatives: null, sourcedata: null },
      entry,
      sourceDataset,
      "snippet",
      "cody",
    );
    expect(root.Authors).toEqual(["cody"]);
    expect(derivatives.Authors).toEqual(["cody"]);
    expect(sourcedata.Authors).toEqual(["cody"]);
  });
});

describe("path constants", () => {
  it("names the dataset root's own file, the derivatives pipeline's, and sourcedata/rawbids's own", () => {
    expect(DATASET_DESCRIPTION_PATH).toBe("dataset_description.json");
    expect(DERIVATIVES_DESCRIPTION_PATH).toBe("derivatives/clip-extractor/dataset_description.json");
    expect(SOURCEDATA_DESCRIPTION_PATH).toBe("sourcedata/rawbids/dataset_description.json");
  });
});
