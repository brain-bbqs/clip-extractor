import { describe, expect, it, vi } from "vitest";
import { drawPose, labelsToPose, trackColor } from "../../src/lib/pose";
import type { PoseInstance, PoseModel, SleapLabels, SleapTrack } from "../../src/lib/types";

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

  it("treats an untracked, unscored instance as a user label with every point missing", () => {
    const labels: SleapLabels = {
      skeletons: [{ name: "mouse", nodeNames: ["head", "tail"], edgeIndices: [] }],
      tracks: [],
      labeledFrames: [{ frameIdx: 0, instances: [{ track: null, score: null, points: undefined }] }],
    };
    const [inst] = labelsToPose(labels).byFrame.get(0)!;
    expect(inst.kind).toBe("user");
    expect(inst.track).toBe(-1);
    expect(inst.score).toBeNull();
    // One null per skeleton node, so drawing code can index points by node without checking length.
    expect(inst.points).toEqual([null, null]);
  });

  it("falls back to an unnamed skeleton when the labels carry none", () => {
    const labels: SleapLabels = { skeletons: [], tracks: [], labeledFrames: [] };
    const pose = labelsToPose(labels);
    expect(pose.skeleton).toEqual({ name: "skeleton", nodes: [], edges: [] });
  });
});

// jsdom hands out no real 2D context, so the drawing is checked against a recorder of one — the
// same calls hit a real canvas in the same order.
function fakeCtx() {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
}

const skeleton: PoseModel["skeleton"] = {
  name: "mouse",
  nodes: ["head", "body", "tail"],
  edges: [
    [0, 1],
    [1, 2],
  ],
};

describe("drawPose", () => {
  it("draws nothing on a frame with no instances", () => {
    const ctx = fakeCtx();
    drawPose(ctx as unknown as CanvasRenderingContext2D, undefined, skeleton, 320);
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  it("draws each edge between its endpoints and a dot per visible point", () => {
    const ctx = fakeCtx();
    const insts: PoseInstance[] = [
      {
        track: 0,
        kind: "predicted",
        score: 0.9,
        points: [
          { x: 1, y: 2, score: 0.9 },
          { x: 3, y: 4, score: 0.9 },
          { x: 5, y: 6, score: 0.9 },
        ],
      },
    ];
    drawPose(ctx as unknown as CanvasRenderingContext2D, insts, skeleton, 320);
    expect(ctx.moveTo).toHaveBeenCalledWith(1, 2);
    expect(ctx.lineTo).toHaveBeenCalledWith(3, 4);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.arc).toHaveBeenCalledTimes(3);
    expect(ctx.fill).toHaveBeenCalledTimes(3);
  });

  it("skips an edge missing either endpoint, and the dot of every missing point", () => {
    const ctx = fakeCtx();
    const insts: PoseInstance[] = [
      { track: 0, kind: "user", score: null, points: [{ x: 1, y: 2, score: null }, null, { x: 5, y: 6, score: null }] },
    ];
    drawPose(ctx as unknown as CanvasRenderingContext2D, insts, skeleton, 320);
    // Both edges touch the missing middle point, so neither is drawn — only the two dots are.
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it("colors an untracked instance in the muted gray, tracked ones from the palette", () => {
    const ctx = fakeCtx();
    const inst = (track: number): PoseInstance => ({ track, kind: "user", score: null, points: [{ x: 1, y: 1, score: null }] });
    drawPose(ctx as unknown as CanvasRenderingContext2D, [inst(-1)], skeleton, 320);
    expect(ctx.fillStyle).toBe("#9aa4b2");
    drawPose(ctx as unknown as CanvasRenderingContext2D, [inst(0)], skeleton, 320);
    expect(ctx.fillStyle).toBe(trackColor(0));
  });

  it("leaves the context's alpha back at full for whoever draws next", () => {
    const ctx = fakeCtx();
    drawPose(
      ctx as unknown as CanvasRenderingContext2D,
      [{ track: 0, kind: "user", score: null, points: [{ x: 1, y: 1, score: null }] }],
      skeleton,
      320,
    );
    expect(ctx.globalAlpha).toBe(1);
  });
});
