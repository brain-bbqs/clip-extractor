import { describe, expect, it } from "vitest";
import {
  ORIGINAL_SUBDIRECTORY,
  UPLOAD_ROOT,
  defaultDeliveryMode,
  fileBrowserUrl,
  selectionDirectory,
  uploadAssetPath,
  uploadDirectory,
  uploadOriginalPath,
} from "../../src/lib/delivery";

describe("selectionDirectory", () => {
  it("names the directory with separate date and time entities, plus what it holds", () => {
    expect(selectionDirectory(new Date("2026-08-09T22:49:13.482Z"), "snippet")).toBe("date-20260809_time-224913_type-snippet");
  });

  it("stands alone, with no archive prefix — a saved bundle unpacks to just this folder", () => {
    expect(selectionDirectory(new Date("2026-08-09T22:49:13.482Z"), "frame")).toBe("date-20260809_time-224913_type-frame");
  });
});

describe("uploadDirectory", () => {
  it("names the directory with separate date and time entities, plus what it holds", () => {
    expect(uploadDirectory(new Date("2026-08-09T22:49:13.482Z"), "snippet")).toBe(`${UPLOAD_ROOT}/date-20260809_time-224913_type-snippet`);
  });

  it("tags a single-frame upload as such", () => {
    expect(uploadDirectory(new Date("2026-08-09T22:49:13.482Z"), "frame")).toBe(`${UPLOAD_ROOT}/date-20260809_time-224913_type-frame`);
  });

  it("uses UTC regardless of the local zone the Date was expressed in", () => {
    // 23:30 at +05:30 is 18:00 UTC the same day; a local-time reading would name the wrong hour,
    // and near midnight the wrong day.
    expect(uploadDirectory(new Date("2026-08-10T23:30:00+05:30"), "snippet")).toBe(`${UPLOAD_ROOT}/date-20260810_time-180000_type-snippet`);
    // 00:30 at +05:30 is the *previous* day in UTC.
    expect(uploadDirectory(new Date("2026-08-10T00:30:00+05:30"), "snippet")).toBe(`${UPLOAD_ROOT}/date-20260809_time-190000_type-snippet`);
  });

  it("zero-pads single-digit months, days and times", () => {
    expect(uploadDirectory(new Date("2026-01-02T03:04:05.000Z"), "snippet")).toBe(`${UPLOAD_ROOT}/date-20260102_time-030405_type-snippet`);
  });

  it("keeps the root at sourcedata/raw", () => {
    expect(UPLOAD_ROOT).toBe("sourcedata/raw/clip-extractor");
  });

  it("is the selection directory under that root, and nothing else", () => {
    const at = new Date("2026-08-09T22:49:13.482Z");
    expect(uploadDirectory(at, "snippet")).toBe(`${UPLOAD_ROOT}/${selectionDirectory(at, "snippet")}`);
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
  it("keeps the original's own name, minus spaces, in its own subdirectory", () => {
    expect(uploadOriginalPath("sourcedata/raw/clip-extractor/stamp", "file_example_480 - Copy.webm")).toBe(
      "sourcedata/raw/clip-extractor/stamp/original/file_example_480-Copy.webm",
    );
  });

  it("separates what was handed to the app from what the app produced", () => {
    const directory = "date-20260810_time-031053_type-snippet";
    expect(uploadOriginalPath(directory, "mice.mp4")).toBe(`${directory}/${ORIGINAL_SUBDIRECTORY}/mice.mp4`);
    expect(uploadAssetPath(directory, "name-mice_range-0+30_type-snippet_video.mp4")).toBe(
      `${directory}/name-mice_range-0+30_type-snippet_video.mp4`,
    );
  });
});

describe("fileBrowserUrl", () => {
  it("deep links into the archive's file browser at the upload's own directory", () => {
    expect(
      fileBrowserUrl("https://dandi.emberarchive.org", "000123", "sourcedata/raw/clip-extractor/date-20260810_time-031053_type-frame"),
    ).toBe(
      "https://dandi.emberarchive.org/dandiset/000123/draft/files?location=sourcedata%2Fraw%2Fclip-extractor%2Fdate-20260810_time-031053_type-frame",
    );
  });

  it("escapes a directory holding a + from a range entity", () => {
    expect(fileBrowserUrl("https://web", "1", "a/date-1_type-snippet")).toContain("location=a%2Fdate-1_type-snippet");
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
