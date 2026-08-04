import { describe, expect, it } from "vitest";
import { labelsToPose, trackColor } from "../../src/lib/pose";
import type { SleapLabels, SleapTrack } from "../../src/lib/types";

describe("trackColor", () => {
  it("returns the muted color for an untracked instance", () => {
    expect(trackColor(-1)).toBe("#9aa4b2");
  });

  it("cycles through the palette by track index", () => {
    expect(trackColor(0)).not.toBe(trackColor(1));
  });
});

describe("labelsToPose", () => {
  it("converts a minimal Labels object into the SLP-free pose model", () => {
    const track: SleapTrack = { name: "mouse1" };
    const labels: SleapLabels = {
      skeletons: [{ name: "mouse", nodeNames: ["head", "tail"], edgeIndices: [[0, 1]] }],
      tracks: [track],
      labeledFrames: [
        {
          frameIdx: 5,
          instances: [
            {
              track,
              score: 0.9,
              points: [
                { xy: [1, 2], visible: true, score: 0.8 },
                { xy: [NaN, NaN], visible: false, score: null },
              ],
            },
          ],
        },
      ],
    };

    const pose = labelsToPose(labels);

    expect(pose.skeleton.nodes).toEqual(["head", "tail"]);
    expect(pose.tracks).toEqual(["mouse1"]);
    const insts = pose.byFrame.get(5);
    expect(insts).toHaveLength(1);
    expect(insts?.[0].kind).toBe("predicted");
    expect(insts?.[0].track).toBe(0);
    expect(insts?.[0].points[0]).toEqual({ x: 1, y: 2, score: 0.8 });
    expect(insts?.[0].points[1]).toBeNull();
  });

  it("skips labeled frames with no instances", () => {
    const labels: SleapLabels = {
      skeletons: [],
      tracks: [],
      labeledFrames: [{ frameIdx: 0, instances: [] }],
    };
    expect(labelsToPose(labels).byFrame.size).toBe(0);
  });
});
