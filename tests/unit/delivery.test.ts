import { describe, expect, it } from "vitest";
import { UPLOAD_ROOT, defaultDeliveryMode, uploadAssetPath, uploadDirectory, uploadOriginalPath } from "../../src/lib/delivery";

describe("uploadDirectory", () => {
  it("names the directory with separate date and time entities, plus what it holds", () => {
    expect(uploadDirectory(new Date("2026-08-09T22:49:13.482Z"), "snippet")).toBe(`${UPLOAD_ROOT}/date-20260809_time-224913_type-snippet`);
  });

  it("tags a single-frame upload as such", () => {
    expect(uploadDirectory(new Date("2026-08-09T22:49:13.482Z"), "frame")).toBe(`${UPLOAD_ROOT}/date-20260809_time-224913_type-frame`);
  });

  it("zero-pads single-digit months, days and times", () => {
    expect(uploadDirectory(new Date("2026-01-02T03:04:05.000Z"), "snippet")).toBe(`${UPLOAD_ROOT}/date-20260102_time-030405_type-snippet`);
  });

  it("keeps the root at sourcedata/raw", () => {
    expect(UPLOAD_ROOT).toBe("sourcedata/raw/clip-extractor");
  });

  it("gives two uploads a second apart their own directories", () => {
    const a = uploadDirectory(new Date("2026-08-09T22:49:13.000Z"), "snippet");
    const b = uploadDirectory(new Date("2026-08-09T22:49:14.000Z"), "snippet");
    expect(a).not.toBe(b);
  });
});

describe("uploadAssetPath", () => {
  it("joins the directory and file name", () => {
    expect(uploadAssetPath("sourcedata/raw/clip-extractor/2026-08-09T22-49-13Z", "name-mice_range-0+30_type-snippet_video.mp4")).toBe(
      "sourcedata/raw/clip-extractor/2026-08-09T22-49-13Z/name-mice_range-0+30_type-snippet_video.mp4",
    );
  });

  it("sanitizes a file name carrying spaces and path separators", () => {
    expect(uploadAssetPath("sourcedata/raw/clip-extractor/stamp", "my video (1)/../odd.MP4")).toBe(
      "sourcedata/raw/clip-extractor/stamp/my+video+_1_.._odd.mp4",
    );
  });
});

describe("uploadOriginalPath", () => {
  it("keeps the original's own name, minus spaces", () => {
    expect(uploadOriginalPath("sourcedata/raw/clip-extractor/stamp", "file_example_480 - Copy.webm")).toBe(
      "sourcedata/raw/clip-extractor/stamp/file_example_480-Copy.webm",
    );
  });
});

describe("defaultDeliveryMode", () => {
  it("defaults to upload when there is a dataset to upload to", () => {
    expect(defaultDeliveryMode(1)).toBe("upload");
  });

  it("defaults to download with no available datasets (signed out, or none granted)", () => {
    expect(defaultDeliveryMode(0)).toBe("download");
  });
});
