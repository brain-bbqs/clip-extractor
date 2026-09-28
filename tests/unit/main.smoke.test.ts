// @vitest-environment jsdom
// Boots the real src/main.ts against the real index.html, signed out with nothing stored, and drives
// the shell: the version stamp, the source picker, the theme toggle and the What's New modal. The id
// contract itself is tests/unit/elements.test.ts's; here getElements() and getShellElements() would
// throw on import if an id main.ts needs were missing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countChangelogVersions } from "@brain-bbqs/ui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const RECENT_VERSIONS = 3;
const changelog = readFileSync(resolve(process.cwd(), "CHANGELOG.md"), "utf-8");
const versions = [...changelog.matchAll(/^## (\S+)/gm)].map((m) => m[1]);

let booted: Awaited<ReturnType<typeof bootMain>>;

beforeAll(async () => {
  booted = await bootMain();
});

const renderedVersions = (): string[] =>
  [...el("whats-new-content").querySelectorAll(".changelog-version h3")].map((h) => h.textContent ?? "");

describe("main.ts boot, signed out", () => {
  it("stamps the package version into the footer link", () => {
    const { version } = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8")) as { version: string };
    expect(el("version-indicator").textContent).toBe(`v${version}`);
  });

  it("opens on the source picker, the stage and player controls off screen until a load begins", () => {
    expect(el("sourcePicker").hidden).toBe(false);
    expect(el("localPane").hidden).toBe(false);
    expect(el("stage").hidden).toBe(true);
    expect(el("playerControls").hidden).toBe(true);
    expect(el("emptyStage").textContent).toBe("Load a video to extract a clip");
    expect(el("loadedSource").hidden).toBe(true);
  });

  it("shows the sign-in button rather than the account menu", () => {
    expect(el("oauthSigninBtn").hidden).toBe(false);
    expect(el("oauthSignedIn").hidden).toBe(true);
  });

  it("offers no upload destination and no delivery toggle", () => {
    expect(el("deliverToggleRow").hidden).toBe(true);
    expect(el("dandisetMessage").textContent).toBe("Please sign in to see your incoming datasets.");
    expect(el<HTMLButtonElement>("btnDownload").disabled).toBe(true);
  });

  it("has the blur tool watch the canvas for resizes", () => {
    const observers = booted.observers.ResizeObserver?.instances ?? [];
    expect(observers.length).toBe(1);
    expect(observers[0].observed).toEqual([el("view")]);
  });

  it("makes no network request while booting", () => {
    expect(booted.fetch?.calls).toEqual([]);
  });

  it("flips the theme from the header toggle and remembers the choice", () => {
    // The harness's matchMedia reports a light OS preference and nothing is stored, so the first
    // click lands on dark.
    el("themeToggle").click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    el("themeToggle").click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });
});

describe("What's New", () => {
  it("renders the latest versions of the real CHANGELOG.md, closed", () => {
    expect(versions.length).toBeGreaterThan(RECENT_VERSIONS);
    expect(renderedVersions()).toEqual(versions.slice(0, RECENT_VERSIONS));
    expect(el("whats-new-show-more").hidden).toBe(false);
    expect(el<HTMLDialogElement>("whats-new-modal").open).toBe(false);
    expect(el("whats-new-button").textContent).toBe("✨ What's New");
  });

  it("opens from the footer link and closes on ×, tracking the #changelog fragment", async () => {
    const modal = el<HTMLDialogElement>("whats-new-modal");
    el("whats-new-button").click();
    expect(modal.open).toBe(true);
    expect(window.location.hash).toBe("#changelog");

    el("whats-new-close").click();
    expect(modal.open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("closes on a backdrop click but not on a click inside it", async () => {
    const modal = el<HTMLDialogElement>("whats-new-modal");
    el("whats-new-button").click();
    el("whats-new-content").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal.open).toBe(true);
    modal.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal.open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("closes on Escape", async () => {
    const modal = el<HTMLDialogElement>("whats-new-modal");
    el("whats-new-button").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(modal.open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("opens when the page is navigated to #changelog", async () => {
    const modal = el<HTMLDialogElement>("whats-new-modal");
    window.location.hash = "changelog";
    await vi.waitFor(() => expect(modal.open).toBe(true));
    el("whats-new-close").click();
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("swaps in the whole changelog behind Show more", () => {
    el("whats-new-show-more").click();
    expect(el("whats-new-show-more").hidden).toBe(true);
    expect(renderedVersions()).toEqual(versions);
    expect(renderedVersions().length).toBe(countChangelogVersions(changelog));
  });
});
