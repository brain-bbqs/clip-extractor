import { describe, expect, it } from "vitest";
import { fakeArchiveBrowse, fromEmberSourcePath, fromEmberSourceUrl, readTestInjection } from "../../src/lib/testInjection";

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

describe("the selection mock_ready marks", () => {
  it("defaults to the frame case, the one needing no ffmpeg.wasm to extract", () => {
    expect(readTestInjection("?test&mock_video&mock_ready")).toMatchObject({ mockReadyMode: "frame" });
  });

  it("reads the bare &frame flag as that same default, spelled out", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&frame")).toMatchObject({ mockReadyMode: "frame" });
  });

  it("reads the bare &snippet flag as the range case", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&snippet")).toMatchObject({ mockReadyMode: "snippet" });
  });

  it("takes the snippet a link asked for when it names both, rather than refusing it", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&frame&snippet")).toMatchObject({ mockReadyMode: "snippet" });
  });

  it("parks the playhead mid-clip by default, not on the frame every video opens at", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&frame")).toMatchObject({ mockReadyFrame: 12 });
  });

  it("takes a frame index from &frame=<n>", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&frame=7")).toMatchObject({ mockReadyFrame: 7 });
  });

  it("marks a real sub-range by default, not the whole recording", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&snippet")).toMatchObject({ mockReadyRange: { lo: 6, hi: 21 } });
  });

  it("takes a range from &snippet=<lo>-<hi>", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&snippet=3-9")).toMatchObject({ mockReadyRange: { lo: 3, hi: 9 } });
  });

  it("puts a range written the wrong way round back in order", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&snippet=9-3")).toMatchObject({ mockReadyRange: { lo: 3, hi: 9 } });
  });

  it("falls back to the defaults for a range it cannot read", () => {
    expect(readTestInjection("?test&mock_video&mock_ready&snippet=nonsense")).toMatchObject({ mockReadyRange: { lo: 6, hi: 21 } });
  });
});

describe("fromEmberSourcePath / fromEmberSourceUrl", () => {
  it("defaults from_ember to off — the 'dropped locally' case &from_local spells out", () => {
    expect(readTestInjection("?test&mock_video&from_local")).toMatchObject({ fromEmber: false });
  });

  it("names a fixed, BIDS-entity-shaped path when from_ember is given", () => {
    const injection = readTestInjection("?test&mock_video&from_ember")!;
    expect(injection.fromEmber).toBe(true);
    expect(fromEmberSourcePath(injection, "clip.mp4")).toBe("sub-01/ses-02/clip.mp4");
    expect(fromEmberSourceUrl(injection, "clip.mp4")).toBe("https://test-injection.invalid/sub-01/ses-02/clip.mp4");
  });

  it("returns null without from_ember, leaving the mock video's source unnamed (sub-unknown)", () => {
    const injection = readTestInjection("?test&mock_video&from_local")!;
    expect(fromEmberSourcePath(injection, "clip.mp4")).toBeNull();
    expect(fromEmberSourceUrl(injection, "clip.mp4")).toBeNull();
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
