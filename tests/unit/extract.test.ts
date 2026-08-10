import { describe, expect, it } from "vitest";
import { bidsLabel, clipFileName, frameFileName, originalFileName, provenanceFileName, sourceBaseName } from "../../src/lib/extract";

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
    expect(clipFileName("mice.mp4", 120, 300)).toBe("name-mice_range-120+300_type-snippet.mp4");
  });

  it("reduces the source name to a legal label", () => {
    expect(clipFileName("my video - Copy.mp4", 0, 20)).toBe("name-my+video+Copy_range-0+20_type-snippet.mp4");
  });
});

describe("frameFileName", () => {
  it("names a single frame with its index in BIDS entity style", () => {
    expect(frameFileName("mice.mp4", 42)).toBe("name-mice_index-42_type-frame.png");
  });
});

describe("provenanceFileName", () => {
  it("repeats a snippet's selection entities, so the sidecar pairs with it visibly", () => {
    expect(provenanceFileName({ sourceName: "mice.mp4", mode: "snippet", inFrame: 120, outFrame: 300 })).toBe(
      "name-mice_range-120+300_type-provenance.json",
    );
  });

  it("repeats a frame's index", () => {
    expect(provenanceFileName({ sourceName: "mice.mp4", mode: "frame", inFrame: 42, outFrame: 42 })).toBe(
      "name-mice_index-42_type-provenance.json",
    );
  });
});

describe("originalFileName", () => {
  it("takes no selection entity, since the original is the whole video", () => {
    expect(originalFileName("mice.mp4")).toBe("name-mice_type-original.mp4");
  });

  it("keeps the source extension, lower-cased, rather than assuming mp4", () => {
    expect(originalFileName("mice - Copy.AVI")).toBe("name-mice+Copy_type-original.avi");
  });

  it("stays extensionless when the source is", () => {
    expect(originalFileName("mice")).toBe("name-mice_type-original");
  });
});
