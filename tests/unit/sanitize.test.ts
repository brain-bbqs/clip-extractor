import { describe, expect, it } from "vitest";
import { sanitizeFilename, sanitizePath, sanitizeSegment } from "../../src/lib/sanitize";

describe("sanitizeSegment", () => {
  it("turns whitespace into + and other disallowed characters into underscores", () => {
    expect(sanitizeSegment("mice cam 2 (final)", "x")).toBe("mice+cam+2+_final");
  });

  it("keeps a + this app generated itself, such as a range entity", () => {
    expect(sanitizeSegment("name-mice_range-0+30_type-snippet", "x")).toBe("name-mice_range-0+30_type-snippet");
  });

  it("strips accents rather than replacing them", () => {
    expect(sanitizeSegment("café", "x")).toBe("cafe");
  });

  it("falls back when nothing usable is left", () => {
    expect(sanitizeSegment("///", "fallback")).toBe("fallback");
  });
});

describe("sanitizeFilename", () => {
  it("keeps the extension, lower-cased, and joins words with +", () => {
    expect(sanitizeFilename("My Video.MP4")).toBe("My+Video.mp4");
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
  });
});

describe("sanitizePath", () => {
  it("sanitizes each prefix segment and drops traversal", () => {
    expect(sanitizePath("sourcedata/raw/../clip extractor", "clip.mp4")).toBe("sourcedata/raw/clip+extractor/clip.mp4");
  });
});
