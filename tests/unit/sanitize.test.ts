import { describe, expect, it } from "vitest";
import { sanitizeFilename, sanitizePath, sanitizeSegment, verbatimFilename } from "../../src/lib/sanitize";

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

describe("verbatimFilename", () => {
  it("leaves an ordinary name completely alone, case and punctuation included", () => {
    expect(verbatimFilename("file_example_480-Copy.WebM")).toBe("file_example_480-Copy.WebM");
  });

  it("removes spaces without substituting anything for them", () => {
    expect(verbatimFilename("file_example_480 - Copy.webm")).toBe("file_example_480-Copy.webm");
  });

  // A browser never hands out a File.name containing a separator, so this is belt-and-braces: what
  // matters is that none survives, leaving one flat name. Interior dots are then inert.
  it("flattens path separators so a name cannot escape its directory", () => {
    const flat = verbatimFilename("../../etc/passwd");
    expect(flat).toBe("_.._etc_passwd");
    expect(/[/\\]/.test(flat)).toBe(false);
  });

  it("falls back when nothing is left", () => {
    expect(verbatimFilename("   ", "original")).toBe("original");
  });
});

describe("sanitizePath", () => {
  it("sanitizes each prefix segment and drops traversal", () => {
    expect(sanitizePath("sourcedata/raw/../clip extractor", "clip.mp4")).toBe("sourcedata/raw/clip+extractor/clip.mp4");
  });
});
