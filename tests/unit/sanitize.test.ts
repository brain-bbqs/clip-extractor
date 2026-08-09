import { describe, expect, it } from "vitest";
import { sanitizeFilename, sanitizePath, sanitizeSegment } from "../../src/lib/sanitize";

describe("sanitizeSegment", () => {
  it("collapses disallowed characters into single underscores", () => {
    expect(sanitizeSegment("mice cam 2 (final)", "x")).toBe("mice_cam_2_final");
  });

  it("strips accents rather than replacing them", () => {
    expect(sanitizeSegment("café", "x")).toBe("cafe");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeSegment("///", "fallback")).toBe("fallback");
  });
});

describe("sanitizeFilename", () => {
  it("keeps the extension and lower-cases it", () => {
    expect(sanitizeFilename("My Video.MP4")).toBe("My_Video.mp4");
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
  });
});

describe("sanitizePath", () => {
  it("sanitizes each prefix segment and drops traversal", () => {
    expect(sanitizePath("sourcedata/raw/../clip extractor", "clip.mp4")).toBe("sourcedata/raw/clip_extractor/clip.mp4");
  });
});
