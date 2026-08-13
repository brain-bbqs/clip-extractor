import { afterEach, describe, expect, it, vi } from "vitest";
import { paintBlurRegions } from "../../src/lib/blur";

// The canvas half of lib/blur.ts, against a recording stand-in for a 2D context: jsdom has no canvas
// implementation, and the browser specs cover what the pixels end up looking like. What is worth
// pinning down here is the shape of the calls — that the blur is clipped to the circles rather than
// smeared over the frame, and above all that a browser without canvas filters takes the mosaic
// path instead of quietly drawing the picture back unblurred.

interface Call {
  name: string;
  args: unknown[];
}

/** A 2D context that records what was asked of it. `filter: null` stands for a browser that has no
 * canvas filter support (older Safari), where the property simply is not there. */
function fakeContext(calls: Call[], { filter = "none" as string | null } = {}): CanvasRenderingContext2D {
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push({ name, args });
  const ctx = {
    canvas: { width: 640, height: 480 },
    imageSmoothingEnabled: true,
    clearRect: record("clearRect"),
    drawImage: record("drawImage"),
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    arc: record("arc"),
    clip: record("clip"),
  } as unknown as CanvasRenderingContext2D;
  if (filter !== null) ctx.filter = filter;
  return ctx;
}

/** Hands every scratch canvas lib/blur.ts creates the same recording context. */
function stubScratchContexts(calls: Call[], options?: { filter: string | null }): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeContext(calls, options));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("paintBlurRegions", () => {
  it("does nothing at all when there is nothing to blur", () => {
    const calls: Call[] = [];
    stubScratchContexts(calls);
    const target: Call[] = [];
    paintBlurRegions(fakeContext(target), [], 640, 480);
    expect(target).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("does nothing on a frame with no size, rather than dividing by one", () => {
    const target: Call[] = [];
    stubScratchContexts([]);
    paintBlurRegions(fakeContext(target), [{ x: 10, y: 10, radius: 20 }], 0, 0);
    expect(target).toEqual([]);
  });

  it("clips to one subpath per region, so the circles do not stitch into one blob", () => {
    const target: Call[] = [];
    stubScratchContexts([]);
    paintBlurRegions(
      fakeContext(target),
      [
        { x: 100, y: 100, radius: 30 },
        { x: 300, y: 200, radius: 60 },
      ],
      640,
      480,
    );
    const names = target.map((c) => c.name);
    expect(names).toEqual(["save", "beginPath", "moveTo", "arc", "moveTo", "arc", "clip", "drawImage", "restore"]);
    // Each arc is preceded by a moveTo onto its own rim.
    expect(target[2].args).toEqual([130, 100]);
    expect(target[3].args.slice(0, 3)).toEqual([100, 100, 30]);
    expect(target[4].args).toEqual([360, 200]);
    expect(target[5].args.slice(0, 3)).toEqual([300, 200, 60]);
  });

  it("draws the blurred copy back past its padding, so the frame lands where it started", () => {
    const target: Call[] = [];
    stubScratchContexts([]);
    // A radius of 60 blurs at sigma 20, which pads the scratch canvas by 3 sigma.
    paintBlurRegions(fakeContext(target), [{ x: 320, y: 240, radius: 60 }], 640, 480);
    const draw = target.find((c) => c.name === "drawImage")!;
    expect(draw.args.slice(1)).toEqual([60, 60, 640, 480, 0, 0, 640, 480]);
  });

  it("blurs the padded copy with the browser's own gaussian, at the regions' strength", () => {
    const calls: Call[] = [];
    stubScratchContexts(calls);
    const scratch = { filters: [] as string[] };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      const ctx = fakeContext(calls);
      return new Proxy(ctx, {
        set(t, k, v) {
          if (k === "filter" && typeof v === "string") scratch.filters.push(v);
          return Reflect.set(t, k, v);
        },
      });
    });
    paintBlurRegions(fakeContext([]), [{ x: 320, y: 240, radius: 60 }], 640, 480);
    expect(scratch.filters).toEqual(["blur(20px)", "none"]);
    // Nine draws build the padded, edge-extended copy — the frame, four stretched edges, four
    // corners — and the tenth is that copy drawn through the filter.
    const padded = calls.filter((c) => c.name === "drawImage");
    expect(padded.length).toBe(10);
  });

  it("falls back to shrink-and-magnify where canvas filters are missing, rather than not blurring", () => {
    const calls: Call[] = [];
    stubScratchContexts(calls, { filter: null });
    const target: Call[] = [];
    paintBlurRegions(fakeContext(target, { filter: null }), [{ x: 320, y: 240, radius: 60 }], 640, 480);
    // The padded copy is drawn down into a canvas a twentieth of the size and back up again, which
    // destroys the detail a gaussian would have destroyed.
    const shrink = calls.find((c) => c.name === "drawImage" && c.args.length === 5)!;
    expect(shrink.args.slice(1)).toEqual([0, 0, 38, 30]);
    const magnify = calls.at(-1)!;
    expect(magnify.name).toBe("drawImage");
    expect(magnify.args.slice(1)).toEqual([0, 0, 38, 30, 0, 0, 760, 600]);
    // And the region is still painted, which is the point: no filter support is not no blur.
    expect(target.map((c) => c.name)).toContain("clip");
  });
});
