import { describe, expect, it } from "vitest";
import { buildAnnotations, countLabeledFramesInRange } from "../../src/lib/annotations";
import type { ClipDescriptor } from "../../src/lib/annotations";
import type { PoseModel } from "../../src/lib/types";

const clip: ClipDescriptor = {
  sourceName: "video.mp4",
  sourceUrl: null,
  originalFilename: "video.mp4",
  author: "cody",
  fps: 30,
  width: 640,
  height: 480,
};

function samplePose(): PoseModel {
  return {
    skeleton: { name: "mouse", nodes: ["head", "tail"], edges: [[0, 1]] },
    tracks: ["mouse1"],
    byFrame: new Map([
      [10, [{ track: 0, kind: "user", score: null, points: [{ x: 1, y: 1, score: null }, null] }]],
      [15, [{ track: -1, kind: "predicted", score: 0.5, points: [null, null] }]],
    ]),
  };
}

describe("buildAnnotations", () => {
  it("re-indexes labeled frames clip-relative within the selection", () => {
    const doc = buildAnnotations(samplePose(), 8, 20, clip);
    expect(doc.format).toBe("sleap-clip-annotations/v1");
    expect(doc.frames).toHaveLength(2);
    expect(doc.frames[0]).toMatchObject({ clip_frame: 2, source_frame: 10 });
    expect(doc.frames[1]).toMatchObject({ clip_frame: 7, source_frame: 15 });
    expect(doc.frames[0].instances[0].track_name).toBe("mouse1");
    expect(doc.frames[1].instances[0].track).toBeNull();
  });

  it("excludes labeled frames outside the selection", () => {
    const doc = buildAnnotations(samplePose(), 0, 9, clip);
    expect(doc.frames).toHaveLength(0);
    expect(doc.labeled_frame_count).toBe(0);
  });

  it("returns a null skeleton and empty tracks with no pose loaded", () => {
    const doc = buildAnnotations(null, 0, 5, clip);
    expect(doc.skeleton).toBeNull();
    expect(doc.tracks).toEqual([]);
    expect(doc.frames).toEqual([]);
  });
});

describe("countLabeledFramesInRange", () => {
  it("counts labeled frames inside [lo, hi]", () => {
    expect(countLabeledFramesInRange(samplePose(), 0, 12)).toBe(1);
    expect(countLabeledFramesInRange(samplePose(), 0, 20)).toBe(2);
  });

  it("returns 0 with no pose loaded", () => {
    expect(countLabeledFramesInRange(null, 0, 100)).toBe(0);
  });
});
