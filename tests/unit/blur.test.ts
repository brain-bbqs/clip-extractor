import { describe, expect, it } from "vitest";
import {
  blurFilterChain,
  blurSigma,
  blurSummary,
  clampRegion,
  defaultBlurRadius,
  frameFit,
  maxBlurRadius,
  radiusSigma,
  MIN_BLUR_RADIUS,
} from "../../src/lib/blur";

describe("blur radii", () => {
  it("bounds an area by the shorter side of the frame", () => {
    expect(maxBlurRadius(1920, 1080)).toBe(540);
    expect(maxBlurRadius(640, 480)).toBe(240);
  });

  it("never lets the bound fall below the minimum, however small the frame", () => {
    expect(maxBlurRadius(4, 4)).toBe(MIN_BLUR_RADIUS);
  });

  it("starts a new area at a tenth of the shorter side", () => {
    expect(defaultBlurRadius(1920, 1080)).toBe(108);
  });

  it("keeps the default inside its own bounds on a tiny frame", () => {
    const radius = defaultBlurRadius(20, 10);
    expect(radius).toBe(MIN_BLUR_RADIUS);
    expect(radius).toBeLessThanOrEqual(maxBlurRadius(20, 10));
  });
});

describe("blurSigma", () => {
  it("is a third of the radius, so the circle spans about six standard deviations", () => {
    expect(radiusSigma(60)).toBe(20);
  });

  it("never drops below a strength that actually removes detail", () => {
    expect(radiusSigma(MIN_BLUR_RADIUS)).toBe(2);
  });

  it("takes the strongest region, since one blurred copy of the frame serves them all", () => {
    expect(
      blurSigma([
        { x: 0, y: 0, radius: 30 },
        { x: 0, y: 0, radius: 90 },
      ]),
    ).toBe(30);
  });

  it("is zero when there is nothing to blur", () => {
    expect(blurSigma([])).toBe(0);
  });
});

describe("clampRegion", () => {
  it("holds the centre inside the frame", () => {
    expect(clampRegion({ x: -40, y: 900, radius: 30 }, 640, 480)).toEqual({ x: 0, y: 480, radius: 30 });
  });

  it("bounds the radius and rounds to whole pixels", () => {
    expect(clampRegion({ x: 10.4, y: 20.6, radius: 9999 }, 640, 480)).toEqual({ x: 10, y: 21, radius: 240 });
    expect(clampRegion({ x: 10, y: 20, radius: 1 }, 640, 480).radius).toBe(MIN_BLUR_RADIUS);
  });
});

describe("frameFit", () => {
  it("scales up to fill a box of the video's own shape, with no letterbox", () => {
    expect(frameFit(640, 480, 320, 240)).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
  });

  it("fits the height and centres sideways in a box wider than the video", () => {
    // The player's own case: `max-height` clamps the box while `width: 100%` holds its width, which
    // is what would stretch a circular area into an ellipse if the frame filled the box.
    const fit = frameFit(876, 496, 320, 240);
    expect(fit.scale).toBeCloseTo(496 / 240, 10);
    expect(fit.offsetX).toBeCloseTo((876 - 320 * (496 / 240)) / 2, 10);
    expect(fit.offsetY).toBeCloseTo(0, 10);
  });

  it("fits the width and centres vertically in a box taller than the video", () => {
    expect(frameFit(320, 480, 320, 240)).toEqual({ scale: 1, offsetX: 0, offsetY: 120 });
  });

  it("puts the centre of the frame at the centre of the box, on one scale for both axes", () => {
    const fit = frameFit(876, 496, 320, 240);
    expect(fit.offsetX + 160 * fit.scale).toBeCloseTo(876 / 2, 10);
    expect(fit.offsetY + 120 * fit.scale).toBeCloseTo(496 / 2, 10);
    // Deliberately not the box's own width scale, which is what a ring placed on that alone used to
    // sit at: on this box it is a third again too large, and lands a circle 80px below its blur.
    expect(fit.scale).toBeLessThan(876 / 320);
  });

  it("reports no mapping at all when there is nothing to fit into", () => {
    expect(frameFit(0, 0, 320, 240).scale).toBe(0);
    expect(frameFit(640, 480, 0, 0).scale).toBe(0);
  });
});

describe("blurFilterChain", () => {
  const chain = blurFilterChain([
    { x: 320, y: 240, radius: 60 },
    { x: 100, y: 50, radius: 30 },
  ]);

  it("blurs one copy of the frame and blends it back inside the circles", () => {
    expect(chain).toContain("split=2[blurbase][blursrc]");
    expect(chain).toContain("[blursrc]gblur=sigma=20[blurred]");
    expect(chain).toContain("[blurbase][blurred]blend=");
  });

  it("tests every region, in luma coordinates on every plane", () => {
    expect(chain).toContain("lt(hypot(X/SW-320.00,Y/SH-240.00),60.00)");
    expect(chain).toContain("lt(hypot(X/SW-100.00,Y/SH-50.00),30.00)");
    // Summed, so a pixel inside both circles is still simply "inside".
    expect(chain).toContain("),60.00)+lt(");
  });

  it("ends on the label the caller maps as the output", () => {
    expect(chain.endsWith("[blurout]")).toBe(true);
    expect(blurFilterChain([{ x: 1, y: 2, radius: 8 }], "masked").endsWith("[masked]")).toBe(true);
  });

  it("quotes the expression, so its commas belong to if() and not to the filter's options", () => {
    expect(chain).toMatch(/all_expr='if\([^']*\)'/);
  });
});

describe("blurSummary", () => {
  it("names the count and the strength, for the provenance record", () => {
    expect(blurSummary([{ x: 0, y: 0, radius: 60 }])).toBe("1 blurred region, gaussian sigma 20");
    expect(
      blurSummary([
        { x: 0, y: 0, radius: 60 },
        { x: 1, y: 1, radius: 30 },
      ]),
    ).toBe("2 blurred regions, gaussian sigma 20");
  });

  it("says nothing when nothing was blurred", () => {
    expect(blurSummary([])).toBe("");
  });
});
