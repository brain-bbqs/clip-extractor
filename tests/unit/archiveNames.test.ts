import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCachedNames, saveCachedNames } from "../../src/lib/archiveNames";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("archive name cache", () => {
  it("hands back what it was given, per archive", () => {
    saveCachedNames("ember", new Map([["000265", "Clip extractor test data"]]));
    saveCachedNames("dandi", new Map([["000003", "A dataset elsewhere"]]));
    expect([...loadCachedNames("ember")]).toEqual([["000265", "Clip extractor test data"]]);
    expect([...loadCachedNames("dandi")]).toEqual([["000003", "A dataset elsewhere"]]);
  });

  it("starts empty for an archive it has never been given", () => {
    expect(loadCachedNames("dandi").size).toBe(0);
  });

  it("replaces rather than merges, so a dataset that left the bucket leaves the cache", () => {
    saveCachedNames("ember", new Map([["000265", "Old"]]));
    saveCachedNames("ember", new Map([["000299", "New"]]));
    expect([...loadCachedNames("ember").keys()]).toEqual(["000299"]);
  });

  it("reads titles fresh once the cached set has aged out", () => {
    saveCachedNames("ember", new Map([["000265", "Clip extractor test data"]]));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 15 * 24 * 60 * 60 * 1000);
    expect(loadCachedNames("ember").size).toBe(0);
  });

  it("starts empty rather than throwing on a cache entry that is not readable", () => {
    localStorage.setItem("clip-extractor.archive-names.v1", "{not json");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadCachedNames("ember").size).toBe(0);
  });
});
