import { describe, expect, it } from "vitest";
import { slpSourceMeta, slpVideoMismatches, slpVideoWarnings, type LoadedVideoMeta } from "../../src/lib/match";
import type { SleapLabels, SleapVideo } from "../../src/lib/types";

/** A `.slp` whose video records the full `[frames, height, width, channels]` shape. */
function labels(video: SleapVideo, frameIndices: number[] = [0]): SleapLabels {
  return {
    skeletons: [{ name: "mouse", nodeNames: ["head"], edgeIndices: [] }],
    tracks: [],
    labeledFrames: frameIndices.map((frameIdx) => ({ frameIdx, instances: [], video })),
    videos: [video],
  };
}

const VIDEO: LoadedVideoMeta = { name: "mice.mp4", frames: 1100, width: 1024, height: 768, fps: 30 };

describe("slpSourceMeta", () => {
  it("reads the source video's shape, fps and basename", () => {
    const meta = slpSourceMeta(labels({ filename: "/data/lab/mice.mp4", shape: [1100, 768, 1024, 1], fps: 30 }));

    expect(meta).toEqual({ filename: "mice.mp4", frames: 1100, height: 768, width: 1024, fps: 30, maxLabeledFrame: 0, videoCount: 1 });
  });

  it("takes the basename of a Windows path and of an image sequence", () => {
    expect(slpSourceMeta(labels({ filename: "C:\\data\\mice.mp4" })).filename).toBe("mice.mp4");
    expect(slpSourceMeta(labels({ filename: ["/img/000.png", "/img/001.png"] })).filename).toBe("000.png");
  });

  it("reports what is missing as null rather than guessing", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4" }, []));

    expect(meta).toEqual({
      filename: "mice.mp4",
      frames: null,
      height: null,
      width: null,
      fps: null,
      maxLabeledFrame: null,
      videoCount: 1,
    });
  });

  it("treats a zero frame count as unrecorded", () => {
    // The reader writes 0 into shape[0] when the frame count could not be resolved.
    expect(slpSourceMeta(labels({ filename: "mice.mp4", shape: [0, 768, 1024, 1] })).frames).toBeNull();
  });

  it("tracks the highest labeled frame index", () => {
    expect(slpSourceMeta(labels({ filename: "mice.mp4" }, [3, 41, 12])).maxLabeledFrame).toBe(41);
  });

  it("bounds the labeled range by the video the labels belong to", () => {
    const labeled: SleapVideo = { filename: "second.mp4", shape: [50, 768, 1024, 1] };
    const other: SleapVideo = { filename: "first.mp4", shape: [1100, 768, 1024, 1] };
    const twoVideos: SleapLabels = {
      skeletons: [],
      tracks: [],
      labeledFrames: [
        { frameIdx: 10, instances: [], video: labeled },
        { frameIdx: 900, instances: [], video: other },
      ],
      videos: [other, labeled],
    };

    const meta = slpSourceMeta(twoVideos);

    expect(meta.filename).toBe("second.mp4");
    expect(meta.frames).toBe(50);
    expect(meta.maxLabeledFrame).toBe(10);
    expect(meta.videoCount).toBe(2);
  });
});

describe("slpVideoMismatches", () => {
  it("passes a .slp that describes the loaded video", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", shape: [1100, 768, 1024, 1], fps: 30 }, [0, 1099]));

    expect(slpVideoMismatches(meta, VIDEO)).toEqual([]);
  });

  it("reports a frame count that does not match", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", shape: [900, 768, 1024, 1] }));

    expect(slpVideoMismatches(meta, VIDEO)).toEqual([{ field: "Frame count", slp: "900 frames", video: "1100 frames" }]);
  });

  it("reports a frame size that does not match", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", shape: [1100, 480, 640, 1] }));

    expect(slpVideoMismatches(meta, VIDEO)).toEqual([{ field: "Frame size", slp: "640×480", video: "1024×768" }]);
  });

  it("reports both fields when both differ", () => {
    const meta = slpSourceMeta(labels({ filename: "other.mp4", shape: [900, 480, 640, 1] }));

    expect(slpVideoMismatches(meta, VIDEO).map((m) => m.field)).toEqual(["Frame count", "Frame size"]);
  });

  it("catches labels running past the end of a video whose length the .slp never recorded", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4" }, [0, 1100]));

    expect(slpVideoMismatches(meta, VIDEO)).toEqual([
      { field: "Labeled frames", slp: "labels up to frame 1100", video: "last frame is 1099" },
    ]);
  });

  it("does not repeat the frame count as a labeled-frame problem", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", shape: [2000, 768, 1024, 1] }, [1500]));

    expect(slpVideoMismatches(meta, VIDEO)).toEqual([{ field: "Frame count", slp: "2000 frames", video: "1100 frames" }]);
  });

  it("skips every check the .slp has no metadata for", () => {
    const meta = slpSourceMeta(labels({ filename: "renamed.mp4" }, [7]));

    expect(slpVideoMismatches(meta, VIDEO)).toEqual([]);
  });

  it("skips every check while the video's own metadata is still unknown", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", shape: [1100, 768, 1024, 1] }));

    expect(slpVideoMismatches(meta, { name: "mice.mp4", frames: 0, width: 0, height: 0, fps: 0 })).toEqual([]);
  });
});

describe("slpVideoWarnings", () => {
  it("says nothing about a matching pair", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", shape: [1100, 768, 1024, 1], fps: 30 }));

    expect(slpVideoWarnings(meta, VIDEO)).toEqual([]);
  });

  it("tolerates an fps that only differs by container rounding", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", fps: 30 }));

    expect(slpVideoWarnings(meta, { ...VIDEO, fps: 29.97 })).toEqual([]);
  });

  it("warns about an fps that differs outright", () => {
    const meta = slpSourceMeta(labels({ filename: "mice.mp4", fps: 60 }));

    expect(slpVideoWarnings(meta, VIDEO)).toEqual(["the .slp records 60.00 fps, the video reports 30.00 fps"]);
  });

  it("warns about a renamed video without refusing it", () => {
    const meta = slpSourceMeta(labels({ filename: "/data/mice_raw.mp4", shape: [1100, 768, 1024, 1] }));

    expect(slpVideoWarnings(meta, VIDEO)).toEqual(['the .slp was labeled against "mice_raw.mp4", the loaded video is "mice.mp4"']);
    expect(slpVideoMismatches(meta, VIDEO)).toEqual([]);
  });

  it("notes that a multi-video .slp was checked against one of its videos", () => {
    const labeled: SleapVideo = { filename: "mice.mp4" };
    const twoVideos: SleapLabels = {
      skeletons: [],
      tracks: [],
      labeledFrames: [{ frameIdx: 0, instances: [], video: labeled }],
      videos: [labeled, { filename: "other.mp4" }],
    };

    expect(slpVideoWarnings(slpSourceMeta(twoVideos), VIDEO)).toEqual([
      "the .slp references 2 videos; it was checked against the one its labels belong to",
    ]);
  });
});
