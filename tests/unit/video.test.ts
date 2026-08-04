import { describe, expect, it } from "vitest";
import { buildFrameOrder, decodeIndex } from "../../src/lib/video";
import type { SleapVideoBackend } from "../../src/lib/types";

function backendWithTimes(times: number[] | null): SleapVideoBackend {
  return {
    getFrame: () => Promise.reject(new Error("not used")),
    getFrameTimes: times ? () => Promise.resolve(times) : undefined,
  };
}

describe("buildFrameOrder", () => {
  it("returns null when the backend can't report frame times", async () => {
    expect(await buildFrameOrder(backendWithTimes(null))).toBeNull();
  });

  it("returns null when decode order already matches display order", async () => {
    expect(await buildFrameOrder(backendWithTimes([0, 1, 2, 3]))).toBeNull();
  });

  it("returns a display->decode map when frames are out of order (B-frames)", async () => {
    const order = await buildFrameOrder(backendWithTimes([0, 2, 1, 3]));
    expect(order).toEqual([0, 2, 1, 3]);
  });

  it("returns null when getFrameTimes rejects", async () => {
    const backend: SleapVideoBackend = {
      getFrame: () => Promise.reject(new Error("not used")),
      getFrameTimes: () => Promise.reject(new Error("boom")),
    };
    expect(await buildFrameOrder(backend)).toBeNull();
  });
});

describe("decodeIndex", () => {
  it("passes through the display index when there is no reorder", () => {
    expect(decodeIndex(null, 5)).toBe(5);
  });

  it("maps through the frame order when one is present", () => {
    expect(decodeIndex([0, 2, 1, 3], 2)).toBe(1);
  });
});
