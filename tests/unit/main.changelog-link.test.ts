// @vitest-environment jsdom
// Boots the real app at /#changelog, the deep link to the What's New modal: it opens at once, and
// closing it strips the fragment again.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootMain, el } from "./helpers/mainHarness";

beforeAll(async () => {
  await bootMain("#changelog");
});

describe("main.ts boot at #changelog", () => {
  it("opens What's New straight away, on the latest versions", () => {
    expect(el<HTMLDialogElement>("whats-new-modal").open).toBe(true);
    expect(el("whats-new-content").querySelectorAll(".changelog-version").length).toBe(3);
    expect(window.location.hash).toBe("#changelog");
  });

  it("drops the fragment on close, leaving the rest of the address alone", async () => {
    el("whats-new-close").click();
    expect(el<HTMLDialogElement>("whats-new-modal").open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
  });
});
