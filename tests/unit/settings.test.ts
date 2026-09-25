import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "@brain-bbqs/ember-client";
import { STORAGE_KEY, THEME_KEY, settingsStore } from "../../src/lib/settings";
import type { StoredSettings } from "../../src/lib/types";

describe("stored settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the keys a returning visitor's browser already holds", () => {
    expect(STORAGE_KEY).toBe("clip-extractor.settings.v1");
    expect(THEME_KEY).toBe("clip-extractor.theme");
    expect(settingsStore.key).toBe(STORAGE_KEY);
  });

  it("round-trips the dandiset id and OAuth tokens", () => {
    settingsStore.save({ dandisetId: "000123", oauth: { accessToken: "tok", expiresAt: 42 } });
    expect(settingsStore.load()).toEqual({ dandisetId: "000123", oauth: { accessToken: "tok", expiresAt: 42 } });
  });

  it("round-trips the chosen delivery mode, so a refresh keeps the visitor's side of the toggle", () => {
    settingsStore.save({ dandisetId: "000123", deliveryMode: "download" });
    expect(settingsStore.load()?.deliveryMode).toBe("download");
  });

  it("leaves the delivery mode unset when the visitor has never picked a side", () => {
    settingsStore.save({ dandisetId: "000123" });
    expect(settingsStore.load()?.deliveryMode).toBe(undefined);
  });

  it("returns null when nothing is stored", () => {
    expect(settingsStore.load()).toBe(null);
  });

  it("returns null (rather than throwing) on unparseable stored settings", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(settingsStore.load()).toBe(null);
  });

  it("clears the stored settings when saving null", () => {
    settingsStore.save({ dandisetId: "000123" });
    settingsStore.save(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(null);
  });

  it("carries on, rather than throwing, when storage refuses the write", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => settingsStore.save({ dandisetId: "000123" })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe("a sign-in stored by the release before the shared archive client", () => {
  // Byte for byte what the app's own saveStoredSettings wrote: JSON.stringify of the whole record
  // under STORAGE_KEY. A visitor signed in before the deploy must still be signed in after it.
  const previous: StoredSettings = {
    dandisetId: "000123",
    oauth: { accessToken: "access-before-deploy", refreshToken: "refresh-before-deploy", expiresAt: 1_900_000_000_000 },
    deliveryMode: "upload",
    windowHalfSeconds: 30,
  };
  const previousRaw =
    '{"dandisetId":"000123","oauth":{"accessToken":"access-before-deploy","refreshToken":"refresh-before-deploy",' +
    '"expiresAt":1900000000000},"deliveryMode":"upload","windowHalfSeconds":30}';

  beforeEach(() => {
    localStorage.clear();
  });

  it("loads the stored record whole, tokens included", () => {
    localStorage.setItem("clip-extractor.settings.v1", previousRaw);
    expect(settingsStore.load()).toEqual(previous);
  });

  it("resolves the stored access token into the config every archive call takes", () => {
    localStorage.setItem("clip-extractor.settings.v1", previousRaw);
    const stored = settingsStore.load();
    const cfg = resolveConfig({ dandisetId: stored?.dandisetId ?? "", oauthAccessToken: stored?.oauth?.accessToken });
    expect(cfg.accessToken).toBe("access-before-deploy");
    expect(cfg.dandisetId).toBe("000123");
  });

  it("writes the record back in exactly the shape the previous release wrote", () => {
    settingsStore.save(previous);
    expect(localStorage.getItem("clip-extractor.settings.v1")).toBe(previousRaw);
    expect(localStorage.length).toBe(1);
  });
});
