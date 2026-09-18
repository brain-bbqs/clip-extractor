import { describe, expect, it } from "vitest";
import { LagMeter, PROXY_MAX_SECONDS, proxyDimensions, proxyWorthwhile } from "../../src/lib/proxy";

describe("proxyWorthwhile", () => {
  it("is true for a range within the limit, in seconds of video", () => {
    expect(proxyWorthwhile(PROXY_MAX_SECONDS * 30, 30)).toBe(true);
    expect(proxyWorthwhile(PROXY_MAX_SECONDS * 30 + 1, 30)).toBe(false);
  });

  it("counts at the recording's own rate, so a faster recording gets more frames", () => {
    expect(proxyWorthwhile(PROXY_MAX_SECONDS * 60, 60)).toBe(true);
    expect(proxyWorthwhile(PROXY_MAX_SECONDS * 60, 30)).toBe(false);
  });

  it("is false for nothing, and for a rate that cannot be measured against", () => {
    expect(proxyWorthwhile(0, 30)).toBe(false);
    expect(proxyWorthwhile(30, 0)).toBe(false);
    expect(proxyWorthwhile(30, Number.NaN)).toBe(false);
  });
});

describe("proxyDimensions", () => {
  it("fits the longer side to the limit, keeping the aspect", () => {
    expect(proxyDimensions(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(proxyDimensions(1080, 1920, 640)).toEqual({ width: 360, height: 640 });
  });

  it("never scales a picture up", () => {
    expect(proxyDimensions(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });

  it("keeps both sides even, which the encoder needs", () => {
    // 1280x1024 scaled to 640 wide is 512 high already; 1000x750 scaled comes to 640x480; and an
    // aspect that lands on an odd height is rounded to the even one beside it.
    expect(proxyDimensions(1000, 750, 640)).toEqual({ width: 640, height: 480 });
    const { width, height } = proxyDimensions(1920, 1085, 640);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
    expect(proxyDimensions(3, 1, 640)).toEqual({ width: 4, height: 2 });
  });
});

describe("LagMeter", () => {
  // A second's window, a third of the frames may go undrawn, two windows in a row to count.
  const meter = () => {
    const m = new LagMeter(1000, 1 / 3, 2);
    m.reset(0);
    return m;
  };
  const rate = 30;

  /** Plays `seconds` of video at `rate`, drawing `share` of the frames due, ticking as a display
   * would. Returns what the meter said at the last tick. */
  function play(m: LagMeter, from: number, seconds: number, share: number): boolean {
    let behind = false;
    const ticks = seconds * 60;
    let drawn = 0;
    for (let i = 1; i <= ticks; i++) {
      const now = from + (i * 1000) / 60;
      const due = ((now - from) / 1000) * rate * share;
      while (drawn < Math.floor(due)) {
        m.drew();
        drawn++;
      }
      behind = m.check(now, rate);
    }
    return behind;
  }

  it("says nothing before a window has passed", () => {
    const m = meter();
    expect(m.check(500, rate)).toBe(false);
  });

  it("stays quiet while every frame due is drawn", () => {
    const m = meter();
    expect(play(m, 0, 3, 1)).toBe(false);
  });

  it("tolerates a few frames dropped to a busy moment", () => {
    const m = meter();
    expect(play(m, 0, 3, 0.8)).toBe(false);
  });

  it("reports playback fallen behind once enough of it has been, for long enough", () => {
    const m = meter();
    expect(play(m, 0, 1, 0.5)).toBe(false);
    expect(play(m, 1000, 1, 0.5)).toBe(true);
  });

  it("starts the count over after a window that kept up", () => {
    const m = meter();
    expect(play(m, 0, 1, 0.5)).toBe(false);
    expect(play(m, 1000, 1, 1)).toBe(false);
    expect(play(m, 2000, 1, 0.5)).toBe(false);
    expect(play(m, 3000, 1, 0.5)).toBe(true);
  });

  it("forgets everything on a reset, as a new play does", () => {
    const m = meter();
    play(m, 0, 1, 0.5);
    m.reset(5000);
    expect(play(m, 5000, 1, 0.5)).toBe(false);
  });

  it("ignores a window with too little due to judge by", () => {
    const m = meter();
    expect(m.check(1000, 0)).toBe(false);
    expect(m.check(2000, 0)).toBe(false);
  });
});
