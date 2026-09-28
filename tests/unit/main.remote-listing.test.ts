// @vitest-environment jsdom
// Boots the real app under `?test&remote_listing=12`: the browse pane opens by itself on a fake
// archive listing, without reading the real archive.
import { beforeAll, describe, expect, it } from "vitest";
import { bootMain, el } from "./helpers/mainHarness";

let booted: Awaited<ReturnType<typeof bootMain>>;

beforeAll(async () => {
  booted = await bootMain("?test&remote_listing=12");
});

describe("main.ts boot with ?test&remote_listing=12", () => {
  it("switches the source picker to the browse pane", () => {
    expect(el("browsePane").hidden).toBe(false);
    expect(el("localPane").hidden).toBe(true);
    expect(el("srcSeg").querySelector("[aria-pressed='true']")?.getAttribute("data-src")).toBe("browse");
  });

  it("lists the fake datasets, four videos to each", () => {
    const rows = [...el("browseDandisets").querySelectorAll("li")].map((li) => li.textContent);
    expect(rows).toEqual(["214000Test dataset 14 videos", "214001Test dataset 24 videos", "214002Test dataset 34 videos"]);
    expect(el("browseStatus").textContent).toBe("");
  });

  it("reads nothing from the archive", () => {
    expect(booted.fetch?.calls).toEqual([]);
  });
});
