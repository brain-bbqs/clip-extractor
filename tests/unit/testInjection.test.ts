import { describe, expect, it } from "vitest";
import { fakeArchiveBrowse, readTestInjection } from "../../src/lib/testInjection";

describe("readTestInjection", () => {
  it("returns null when the page was not asked to fake anything", () => {
    expect(readTestInjection("")).toBeNull();
    expect(readTestInjection("?foo=bar")).toBeNull();
  });

  it("defaults mock_ready to off — the gated, 'describe it first' state mock_video alone previews", () => {
    expect(readTestInjection("?test&mock_video")).toMatchObject({ mockReady: false });
  });

  it("reads the bare mock_ready flag", () => {
    expect(readTestInjection("?test&mock_video&mock_ready")).toMatchObject({ mockReady: true });
  });
});

describe("fakeArchiveBrowse", () => {
  it("names each fake video's path in BIDS-entity shape, zero-padded", () => {
    const { videos } = fakeArchiveBrowse(1);
    const [video] = [...videos.values()].flat();
    expect(video.path).toBe("sub-01/ses-01/video-1.mp4");
  });

  it("spreads across as many fake datasets as it takes, numbering each subject in turn", () => {
    const { datasets, videos } = fakeArchiveBrowse(5);
    expect(datasets).toHaveLength(2);
    const [first, second] = datasets;
    expect(videos.get(first.id)!.map((v) => v.path)).toEqual([
      "sub-01/ses-01/video-1.mp4",
      "sub-01/ses-02/video-2.mp4",
      "sub-01/ses-03/video-3.mp4",
      "sub-01/ses-04/video-4.mp4",
    ]);
    expect(videos.get(second.id)!.map((v) => v.path)).toEqual(["sub-02/ses-01/video-1.mp4"]);
  });

  it("resolves each video's URL nowhere real, a truthful refusal rather than a dead button", () => {
    const { videos } = fakeArchiveBrowse(1);
    const [video] = [...videos.values()].flat();
    expect(video.assetUrl).toMatch(/^https:\/\/test-injection\.invalid\//);
    expect(video.streamUrl).toBe(video.assetUrl);
  });
});
