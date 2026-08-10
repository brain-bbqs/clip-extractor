import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY, loadStoredSettings, resolveConfig, saveStoredSettings } from "../../src/lib/settings";
import { EMBER_INSTANCE } from "../../src/lib/instances";

describe("resolveConfig", () => {
  it("resolves the EMBER instance URLs and the access token", () => {
    const cfg = resolveConfig({ dandisetId: "000123", oauthAccessToken: "tok" });
    expect(cfg.api).toBe(EMBER_INSTANCE.api);
    expect(cfg.web).toBe(EMBER_INSTANCE.web);
    expect(cfg.accessToken).toBe("tok");
  });

  it("extracts a six-digit dandiset id out of a longer label", () => {
    expect(resolveConfig({ dandisetId: "(000456) Incoming: Lab" }).dandisetId).toBe("000456");
  });

  it("blanks the token when signed out", () => {
    expect(resolveConfig({ dandisetId: "000123" }).accessToken).toBe("");
  });

  it("rejects a hyphen-prefixed id so a placeholder never resolves to a real dandiset", () => {
    expect(resolveConfig({ dandisetId: "-000001" }).dandisetId).toBe("");
  });

  it("carries the embargo status through untouched", () => {
    expect(resolveConfig({ dandisetId: "000123", embargoed: false }).embargoed).toBe(false);
    expect(resolveConfig({ dandisetId: "000123" }).embargoed).toBe(undefined);
  });
});

describe("stored settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the dandiset id and OAuth tokens", () => {
    saveStoredSettings({ dandisetId: "000123", oauth: { accessToken: "tok", expiresAt: 42 } });
    expect(loadStoredSettings()).toEqual({ dandisetId: "000123", oauth: { accessToken: "tok", expiresAt: 42 } });
  });

  it("round-trips the chosen delivery mode, so a refresh keeps the visitor's side of the toggle", () => {
    saveStoredSettings({ dandisetId: "000123", deliveryMode: "download" });
    expect(loadStoredSettings()?.deliveryMode).toBe("download");
  });

  it("leaves the delivery mode unset when the visitor has never picked a side", () => {
    saveStoredSettings({ dandisetId: "000123" });
    expect(loadStoredSettings()?.deliveryMode).toBe(undefined);
  });

  it("returns null when nothing is stored", () => {
    expect(loadStoredSettings()).toBe(null);
  });

  it("returns null (rather than throwing) on unparseable stored settings", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadStoredSettings()).toBe(null);
  });

  it("clears the stored settings when saving null", () => {
    saveStoredSettings({ dandisetId: "000123" });
    saveStoredSettings(null);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(null);
  });
});
