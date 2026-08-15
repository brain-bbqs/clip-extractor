import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCachedNames, saveCachedNames } from "../../src/lib/archiveNames";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("dataset name cache", () => {
  it("hands back what it was given", () => {
    saveCachedNames(new Map([["000265", "Clip extractor test data"]]));
    expect([...loadCachedNames()]).toEqual([["000265", "Clip extractor test data"]]);
  });

  it("starts empty before it has ever been given anything", () => {
    expect(loadCachedNames().size).toBe(0);
  });

  it("replaces rather than merges, so a dataset that left the bucket leaves the cache", () => {
    saveCachedNames(new Map([["000265", "Old"]]));
    saveCachedNames(new Map([["000299", "New"]]));
    expect([...loadCachedNames().keys()]).toEqual(["000299"]);
  });

  it("reads titles fresh once the cached set has aged out", () => {
    saveCachedNames(new Map([["000265", "Clip extractor test data"]]));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 15 * 24 * 60 * 60 * 1000);
    expect(loadCachedNames().size).toBe(0);
  });

  it("starts empty rather than throwing on a cache entry that is not readable", () => {
    localStorage.setItem("clip-extractor.archive-names.v1", "{not json");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadCachedNames().size).toBe(0);
  });
});
