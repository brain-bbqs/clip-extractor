import { describe, expect, it } from "vitest";
import { fakeArchiveBrowse, fromArchiveSourcePath, fromArchiveSourceUrl, readTestInjection } from "../../src/lib/testInjection";

describe("readTestInjection", () => {
  it("returns null when the page was not asked to fake anything", () => {
    expect(readTestInjection("")).toBeNull();
    expect(readTestInjection("?foo=bar")).toBeNull();
  });

  it("defaults mock_ready to off — the gated, 'describe it first' state mock_video alone previews", () => {
    expect(readTestInjection("?test&mock_video")).toMatchObject({ mockReady: false, mockReadySnippet: false });
  });

  it("reads the bare mock_ready flag as the frame case", () => {
    expect(readTestInjection("?test&mock_video&mock_ready")).toMatchObject({ mockReady: true, mockReadySnippet: false });
  });

  it("reads mock_ready=snippet as the snippet case", () => {
    expect(readTestInjection("?test&mock_video&mock_ready=snippet")).toMatchObject({ mockReady: true, mockReadySnippet: true });
  });

  it("defaults from_archive to off — the 'dropped locally' case mock_video alone previews", () => {
    expect(readTestInjection("?test&mock_video")).toMatchObject({ fromArchive: false });
  });

  it("reads the bare from_archive flag", () => {
    expect(readTestInjection("?test&mock_video&from_archive")).toMatchObject({ fromArchive: true });
  });
});

describe("fromArchiveSourcePath / fromArchiveSourceUrl", () => {
  it("names a fixed, BIDS-entity-shaped path when from_archive is given", () => {
    const injection = readTestInjection("?test&mock_video&from_archive")!;
    expect(fromArchiveSourcePath(injection, "clip.webm")).toBe("sub-01/ses-02/clip.webm");
    expect(fromArchiveSourceUrl(injection, "clip.webm")).toBe("https://test-injection.invalid/sub-01/ses-02/clip.webm");
  });

  it("returns null without from_archive, leaving the mock video's source unnamed (sub-unknown)", () => {
    const injection = readTestInjection("?test&mock_video")!;
    expect(fromArchiveSourcePath(injection, "clip.webm")).toBeNull();
    expect(fromArchiveSourceUrl(injection, "clip.webm")).toBeNull();
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
