import { describe, expect, it } from "vitest";
import { defaultDeliveryMode, deliveryDirectories, fileBrowserUrl, uploadAssetPath } from "../../src/lib/delivery";
import type { BehEntities } from "../../src/lib/bidsPath";

const beh: BehEntities = { sub: "1", ses: null, known: true, recording: "unused", date: "20260809", time: "224913" };
const behWithSession: BehEntities = { ...beh, ses: "2" };

describe("deliveryDirectories", () => {
  it("puts the app's own output under derivatives/clip-extractor, mirroring sub/ses", () => {
    expect(deliveryDirectories(beh).derivatives).toBe("derivatives/clip-extractor/sub-1/beh");
  });

  it("puts the original content under sourcedata/rawbids, mirroring the same sub/ses — a complete, independently valid raw BIDS dataset of its own", () => {
    expect(deliveryDirectories(beh).sourcedata).toBe("sourcedata/rawbids/sub-1/beh");
  });

  it("includes the session entity in both directories when there is one", () => {
    expect(deliveryDirectories(behWithSession)).toEqual({
      derivatives: "derivatives/clip-extractor/sub-1/ses-2/beh",
      sourcedata: "sourcedata/rawbids/sub-1/ses-2/beh",
    });
  });
});

describe("uploadAssetPath", () => {
  it("joins the directory and file name", () => {
    expect(uploadAssetPath("derivatives/clip-extractor/sub-1/beh", "sub-1_recording-20260809T224913Z_video.mp4")).toBe(
      "derivatives/clip-extractor/sub-1/beh/sub-1_recording-20260809T224913Z_video.mp4",
    );
  });

  it("sanitizes a directory segment carrying spaces and path separators, leaving an already-legal file name untouched", () => {
    expect(uploadAssetPath("sourcedata/sub 1/beh/../beh", "sub-1_recording-20260809T224913Z_video.mp4")).toBe(
      "sourcedata/sub+1/beh/beh/sub-1_recording-20260809T224913Z_video.mp4",
    );
  });
});

describe("fileBrowserUrl", () => {
  it("deep links into the archive's file browser at the upload's own directory", () => {
    expect(fileBrowserUrl("https://dandi.emberarchive.org", "000123", "derivatives/clip-extractor/sub-1/beh")).toBe(
      "https://dandi.emberarchive.org/dandiset/000123/draft/files?location=derivatives%2Fclip-extractor%2Fsub-1%2Fbeh",
    );
  });

  it("escapes a directory holding characters that need it", () => {
    expect(fileBrowserUrl("https://web", "1", "a/sub-1 copy/beh")).toContain("location=a%2Fsub-1%20copy%2Fbeh");
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
