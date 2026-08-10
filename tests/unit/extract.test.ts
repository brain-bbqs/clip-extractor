import { describe, expect, it } from "vitest";
import { bidsLabel, clipFileName, frameFileName, provenanceFileName, sourceBaseName } from "../../src/lib/extract";

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

describe("bidsLabel", () => {
  it("keeps an already-legal label untouched", () => {
    expect(bidsLabel("mice")).toBe("mice");
  });

  it("turns spaces into + so word boundaries survive", () => {
    expect(bidsLabel("my clip")).toBe("my+clip");
  });

  it("drops the separators BIDS reserves, so the entity stays parseable", () => {
    expect(bidsLabel("file_example_480 - Copy")).toBe("fileexample480+Copy");
  });

  it("collapses a run of separators into a single +", () => {
    expect(bidsLabel("a  -  b")).toBe("a+b");
  });

  it("strips accents rather than replacing them", () => {
    expect(bidsLabel("café")).toBe("cafe");
  });

  it("falls back when nothing legal is left", () => {
    expect(bidsLabel("___")).toBe("clip");
  });
});

describe("clipFileName", () => {
  it("names a snippet with its frame range in BIDS entity style", () => {
    expect(clipFileName("mice.mp4", 120, 300)).toBe("name-mice_range-120+300_type-snippet_video.mp4");
  });

  it("reduces the source name to a legal label", () => {
    expect(clipFileName("my video - Copy.mp4", 0, 20)).toBe("name-my+video+Copy_range-0+20_type-snippet_video.mp4");
  });
});

describe("frameFileName", () => {
  it("names a single frame with its index in BIDS entity style", () => {
    expect(frameFileName("mice.mp4", 42)).toBe("name-mice_index-42_type-frame_image.png");
  });
});

describe("provenanceFileName", () => {
  it("mirrors the snippet it describes, down to its type entity, plus a provenance suffix", () => {
    expect(provenanceFileName({ sourceName: "mice.mp4", mode: "snippet", inFrame: 120, outFrame: 300 })).toBe(
      "name-mice_range-120+300_type-snippet_provenance.json",
    );
  });

  it("mirrors a single frame the same way", () => {
    expect(provenanceFileName({ sourceName: "mice.mp4", mode: "frame", inFrame: 42, outFrame: 42 })).toBe(
      "name-mice_index-42_type-frame_provenance.json",
    );
  });
});
