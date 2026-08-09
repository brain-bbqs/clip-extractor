import { describe, expect, it } from "vitest";
import { clipFileName, frameFileName, sourceBaseName } from "../../src/lib/extract";

describe("sourceBaseName", () => {
  it("drops the extension", () => {
    expect(sourceBaseName("mice.mp4")).toBe("mice");
  });

  it("keeps dots that are part of the name", () => {
    expect(sourceBaseName("mice.tracked.session.avi")).toBe("mice.tracked.session");
  });

  it("falls back for an extension-only name", () => {
    expect(sourceBaseName(".mp4")).toBe("clip");
  });
});

describe("clipFileName", () => {
  it("records the extracted frame range", () => {
    expect(clipFileName("mice.mp4", 120, 300)).toBe("mice_clip_120-300.mp4");
  });
});

describe("frameFileName", () => {
  it("zero-pads the frame index so names sort in order", () => {
    expect(frameFileName("mice.mp4", 42)).toBe("mice_frame_000042.png");
  });
});
