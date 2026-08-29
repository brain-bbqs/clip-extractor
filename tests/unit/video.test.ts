import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFrameOrder, decodeIndex, drawVideoFrame } from "../../src/lib/video";
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

// jsdom defines neither ImageBitmap nor ImageData, the two shapes a backend most often hands back,
// so both are stood in for: the stand-in ImageData holds the browser's own length rule, which is
// what the malformed-buffer case below runs into.
class FakeImageBitmap {}
class FakeImageData {
  data: Uint8ClampedArray;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    if (data.length !== width * height * 4) throw new Error("Invalid ImageData buffer length");
    this.data = data;
  }
}

function fakeCtx() {
  return { drawImage: vi.fn(), putImageData: vi.fn() };
}

describe("drawVideoFrame", () => {
  beforeEach(() => {
    vi.stubGlobal("ImageBitmap", FakeImageBitmap);
    vi.stubGlobal("ImageData", FakeImageData);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws an ImageBitmap straight onto the canvas", () => {
    const ctx = fakeCtx();
    const bitmap = new FakeImageBitmap();
    drawVideoFrame(bitmap as ImageBitmap, ctx as unknown as CanvasRenderingContext2D, 2, 2);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });

  it("puts an ImageData's pixels directly", () => {
    const ctx = fakeCtx();
    const data = new FakeImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2);
    drawVideoFrame(data as unknown as ImageData, ctx as unknown as CanvasRenderingContext2D, 2, 2);
    expect(ctx.putImageData).toHaveBeenCalledWith(data, 0, 0);
  });

  it("wraps a raw ArrayBuffer of pixels into ImageData at the given size", () => {
    const ctx = fakeCtx();
    drawVideoFrame(new ArrayBuffer(2 * 2 * 4), ctx as unknown as CanvasRenderingContext2D, 2, 2);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    const drawn = ctx.putImageData.mock.calls[0][0] as FakeImageData;
    expect(drawn).toBeInstanceOf(FakeImageData);
    expect(drawn.data.length).toBe(16);
  });

  it("reads a typed array's underlying buffer the same way", () => {
    const ctx = fakeCtx();
    drawVideoFrame(new Uint8Array(2 * 2 * 4), ctx as unknown as CanvasRenderingContext2D, 2, 2);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
  });

  it("leaves the canvas untouched for a buffer that does not match the frame size", () => {
    const ctx = fakeCtx();
    expect(() => drawVideoFrame(new ArrayBuffer(3), ctx as unknown as CanvasRenderingContext2D, 2, 2)).not.toThrow();
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });
});
