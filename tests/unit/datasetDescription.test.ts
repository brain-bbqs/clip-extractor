import { describe, expect, it, vi } from "vitest";
import {
  DATASET_DESCRIPTION_PATH,
  DERIVATIVES_DESCRIPTION_PATH,
  mergedDatasetDescriptions,
  readExistingDatasetDescriptions,
} from "../../src/lib/datasetDescription";
import { buildGeneratedByEntry } from "../../src/lib/generatedBy";
import type { ArchiveConfig, Asset } from "../../src/lib/types";

const cfg: ArchiveConfig = { api: "https://api.test/api", web: "https://web.test", accessToken: "tok", dandisetId: "000123" };

vi.mock("../../src/lib/upload", () => ({ findExistingAsset: vi.fn() }));
import { findExistingAsset } from "../../src/lib/upload";

describe("readExistingDatasetDescriptions", () => {
  it("reports both files null when neither is registered", async () => {
    vi.mocked(findExistingAsset).mockResolvedValue(null);
    await expect(readExistingDatasetDescriptions(cfg)).resolves.toEqual({ root: null, derivatives: null });
  });

  it("reads an existing file's content, not just that it exists", async () => {
    const rootDoc = { Name: "000123", BIDSVersion: "1.10.0", DatasetType: "raw" };
    vi.mocked(findExistingAsset).mockImplementation(async (_cfg, path) =>
      path === DATASET_DESCRIPTION_PATH ? ({ asset_id: "a1", path } as Asset) : null,
    );
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => rootDoc });
    try {
      await expect(readExistingDatasetDescriptions(cfg)).resolves.toEqual({ root: rootDoc, derivatives: null });
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
  it("builds both files fresh when neither exists yet", () => {
    const entry = buildGeneratedByEntry();
    const { root, derivatives } = mergedDatasetDescriptions({ root: null, derivatives: null }, entry, "000123");
    expect(root).toEqual({ Name: "000123", BIDSVersion: expect.any(String), DatasetType: "raw", GeneratedBy: [entry] });
    expect(derivatives.DatasetType).toBe("derivative");
    expect(derivatives.GeneratedBy).toEqual([entry]);
  });

  it("folds into an existing pair without disturbing another pipeline's entries", () => {
    const other = { Name: "other-tool", Version: "2.0.0" };
    const entry = buildGeneratedByEntry();
    const existing = {
      root: { Name: "000123", BIDSVersion: "1.9.0", DatasetType: "raw" as const, GeneratedBy: [other] },
      derivatives: null,
    };
    const { root } = mergedDatasetDescriptions(existing, entry, "000123");
    expect(root.GeneratedBy).toEqual([other, entry]);
  });
});

describe("path constants", () => {
  it("names the dataset root's own file and the pipeline's own", () => {
    expect(DATASET_DESCRIPTION_PATH).toBe("dataset_description.json");
    expect(DERIVATIVES_DESCRIPTION_PATH).toBe("derivatives/clip-extractor/dataset_description.json");
  });
});
