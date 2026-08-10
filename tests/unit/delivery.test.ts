import { describe, expect, it } from "vitest";
import { UPLOAD_ROOT, defaultDeliveryMode, uploadAssetPath, uploadDirectory } from "../../src/lib/delivery";

describe("uploadDirectory", () => {
  it("timestamps a directory under the clip-extractor upload root, tagged with what it holds", () => {
    expect(uploadDirectory(new Date("2026-08-09T22:49:13.482Z"), "snippet")).toBe(`${UPLOAD_ROOT}/2026-08-09T22-49-13Z_snippet`);
  });

  it("tags a single-frame upload as such", () => {
    expect(uploadDirectory(new Date("2026-08-09T22:49:13.482Z"), "frame")).toBe(`${UPLOAD_ROOT}/2026-08-09T22-49-13Z_frame`);
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
    expect(uploadAssetPath("sourcedata/raw/clip-extractor/2026-08-09T22-49-13Z", "mice_clip_0-30.mp4")).toBe(
      "sourcedata/raw/clip-extractor/2026-08-09T22-49-13Z/mice_clip_0-30.mp4",
    );
  });

  it("sanitizes a file name carrying spaces and path separators", () => {
    expect(uploadAssetPath("sourcedata/raw/clip-extractor/stamp", "my video (1)/../odd.MP4")).toBe(
      "sourcedata/raw/clip-extractor/stamp/my_video_1_.._odd.mp4",
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
