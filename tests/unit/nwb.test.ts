import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { alignDenseFrames, poseSeriesLength, probeNwbSeriesLength, type H5Entity } from "../../src/lib/nwb";
import type { PoseInstance, PoseModel } from "../../src/lib/types";

/** Builds an {@link H5Entity} over a flat path → node map, the way h5wasm answers `get()` with a
 * full path from the root. */
function h5(nodes: Record<string, { type?: string; children?: string[]; shape?: number[] }>): H5Entity {
  const node = (path: string): H5Entity | null => {
    const spec = nodes[path];
    if (!spec) return null;
    return {
      attrs: spec.type ? { neurodata_type: { value: spec.type } } : {},
      shape: spec.shape,
      keys: spec.children ? () => spec.children! : undefined,
      get: (child: string) => node(`${path}/${child}`),
    };
  };
  return { get: (path: string) => node(path), keys: () => Object.keys(nodes) };
}

/** A one-track, two-node ndx-pose predictions file with `frames` samples per series. */
function predictions(frames: number, extra: Record<string, { type?: string; children?: string[]; shape?: number[] }> = {}): H5Entity {
  return h5({
    processing: { children: ["behavior"] },
    "processing/behavior": { children: ["track=mouse1"] },
    "processing/behavior/track=mouse1": { type: "PoseEstimation", children: ["nose", "tail"] },
    "processing/behavior/track=mouse1/nose": { type: "PoseEstimationSeries", children: ["data"] },
    "processing/behavior/track=mouse1/nose/data": { shape: [frames, 2] },
    "processing/behavior/track=mouse1/tail": { type: "PoseEstimationSeries", children: ["data"] },
    "processing/behavior/track=mouse1/tail/data": { shape: [frames, 2] },
    ...extra,
  });
}

describe("poseSeriesLength", () => {
  it("reads the sample count off a PoseEstimationSeries data array", () => {
    expect(poseSeriesLength(predictions(1100))).toBe(1100);
  });

  it("takes the longest series when they disagree", () => {
    const uneven = predictions(1100, {
      "processing/behavior/track=mouse1/tail/data": { shape: [900, 2] },
    });

    expect(poseSeriesLength(uneven)).toBe(1100);
  });

  it("walks every processing module and every track", () => {
    const twoTracks = h5({
      processing: { children: ["behavior", "extra"] },
      "processing/behavior": { children: ["track=mouse1"] },
      "processing/behavior/track=mouse1": { type: "PoseEstimation", children: ["nose"] },
      "processing/behavior/track=mouse1/nose": { type: "PoseEstimationSeries", children: ["data"] },
      "processing/behavior/track=mouse1/nose/data": { shape: [40, 2] },
      "processing/extra": { children: ["track=mouse2"] },
      "processing/extra/track=mouse2": { type: "PoseEstimation", children: ["nose"] },
      "processing/extra/track=mouse2/nose": { type: "PoseEstimationSeries", children: ["data"] },
      "processing/extra/track=mouse2/nose/data": { shape: [90, 2] },
    });

    expect(poseSeriesLength(twoTracks)).toBe(90);
  });

  it("ignores containers that are not pose data", () => {
    const notPose = h5({
      processing: { children: ["behavior"] },
      "processing/behavior": { children: ["Skeletons", "TimeSeries"] },
      "processing/behavior/Skeletons": { type: "Skeletons", children: ["Skeleton"] },
      "processing/behavior/TimeSeries": { type: "TimeSeries", children: ["data"] },
      "processing/behavior/TimeSeries/data": { shape: [5000, 2] },
    });

    expect(poseSeriesLength(notPose)).toBeNull();
  });

  it("returns null for a file with no processing group at all", () => {
    expect(poseSeriesLength(h5({}))).toBeNull();
  });

  it("skips a series whose data array has no readable shape", () => {
    const noShape = predictions(40, {
      "processing/behavior/track=mouse1/nose/data": {},
      "processing/behavior/track=mouse1/tail/data": {},
    });

    expect(poseSeriesLength(noShape)).toBeNull();
  });

  it("reads a scalar neurodata_type handed back as a one-element array", () => {
    // h5wasm returns a string attribute either bare or wrapped, depending on how it was written.
    const wrapped: H5Entity = {
      get: (path: string) =>
        ({
          processing: { keys: () => ["behavior"], get: () => null },
          "processing/behavior": { keys: () => ["track=mouse1"], get: () => null },
          "processing/behavior/track=mouse1": {
            attrs: { neurodata_type: { value: ["PoseEstimation"] } },
            keys: () => ["nose"],
            get: () => null,
          },
          "processing/behavior/track=mouse1/nose": { attrs: { neurodata_type: { value: ["PoseEstimationSeries"] } }, get: () => null },
          "processing/behavior/track=mouse1/nose/data": { shape: [77, 2] },
        })[path] ?? null,
    };

    expect(poseSeriesLength(wrapped)).toBe(77);
  });
});

describe("probeNwbSeriesLength", () => {
  it("measures the series in a real ndx-pose file", async () => {
    // Resolved off the vitest root rather than import.meta.url: under jsdom that is an http URL.
    const file = readFileSync(resolve(process.cwd(), "tests/fixtures/mice.pose.nwb"));

    expect(await probeNwbSeriesLength(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)).toBe(8);
  });

  it("reports null rather than throwing on bytes that are not HDF5 at all", async () => {
    expect(await probeNwbSeriesLength(new TextEncoder().encode("not an hdf5 file").buffer as ArrayBuffer)).toBeNull();
  });
});

const INSTANCE: PoseInstance = { track: 0, kind: "predicted", score: 0.9, points: [] };

function pose(frames: number[]): PoseModel {
  return {
    skeleton: { name: "mouse", nodes: ["nose"], edges: [] },
    tracks: ["mouse1"],
    byFrame: new Map(frames.map((f) => [f, [{ ...INSTANCE, score: f }]])),
  };
}

describe("alignDenseFrames", () => {
  it("re-indexes a dense series whose timestamps were read as spread-out frames", () => {
    // 100 samples over a 100-frame video, but seconds at 0.5 fps rounded to 0, 2, 4, …
    const spread = pose([...Array(100).keys()].map((i) => i * 2));

    const aligned = alignDenseFrames(spread, 100, 100);

    expect([...aligned.byFrame.keys()]).toEqual([...Array(100).keys()]);
    // The instances travel with their sample, in order.
    expect(aligned.byFrame.get(1)?.[0].score).toBe(2);
    expect(aligned.byFrame.get(99)?.[0].score).toBe(198);
  });

  it("leaves an already-aligned model alone, and is safe to re-run", () => {
    const dense = pose([...Array(40).keys()]);

    expect(alignDenseFrames(dense, 40, 40)).toBe(dense);
    expect(alignDenseFrames(alignDenseFrames(pose([0, 2, 4, 6]), 4, 4), 4, 4).byFrame.size).toBe(4);
  });

  it("leaves a series that is not one sample per video frame alone", () => {
    // Shorter than the video: the labels may be genuinely sparse, and only the recorded indices
    // know which frames they belong to.
    const sparse = pose([10, 47, 300]);

    expect(alignDenseFrames(sparse, 3, 1100)).toBe(sparse);
  });

  it("leaves a series alone when frames were dropped before they became labels", () => {
    // 100 samples, but the last five were all-NaN and never became labeled frames, so which sample
    // each surviving frame came from is no longer known.
    const dropped = pose([...Array(95).keys()]);

    expect(alignDenseFrames(dropped, 100, 100)).toBe(dropped);
  });

  it("does nothing without a measured series or a known video length", () => {
    const spread = pose([0, 2, 4]);

    expect(alignDenseFrames(spread, null, 3)).toBe(spread);
    expect(alignDenseFrames(spread, 3, null)).toBe(spread);
  });
});
