import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, routeFetch } from "@brain-bbqs/test-utils/vitest";
import {
  EMBER_SANDBOX_INSTANCE,
  listSandboxIncomingDandisets,
  readSandbox,
  rememberSandboxLogin,
  SANDBOX_LOGIN_KEY,
  takeSandboxLogin,
  withSandboxParam,
} from "../../src/lib/sandbox";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSandbox", () => {
  it("is off on an ordinary load", () => {
    expect(readSandbox("", null)).toBe(false);
    expect(readSandbox("?url=https%3A%2F%2Fexample.org%2Fa.mp4&test", null)).toBe(false);
  });

  it("is on whenever the param is there, with or without a value", () => {
    expect(readSandbox("?sandbox", null)).toBe(true);
    expect(readSandbox("?sandbox=", null)).toBe(true);
    expect(readSandbox("?test&sandbox&num_datasets=1", null)).toBe(true);
  });

  it("is on for the load a sandbox sign-in returns to, matched by its state", () => {
    expect(readSandbox("?code=c&state=s1", "s1")).toBe(true);
  });

  it("leaves a production sign-in's callback to production", () => {
    // No sandbox sign-in in flight, and one whose state is not the one coming back.
    expect(readSandbox("?code=c&state=s1", null)).toBe(false);
    expect(readSandbox("?code=c&state=s1", "s2")).toBe(false);
  });

  it("needs a code, not a state on its own", () => {
    expect(readSandbox("?state=s1", "s1")).toBe(false);
  });
});

describe("withSandboxParam", () => {
  it("adds the bare flag in front of whatever is there", () => {
    expect(withSandboxParam("")).toBe("?sandbox");
    expect(withSandboxParam("?code=c&state=s")).toBe("?sandbox&code=c&state=s");
  });

  it("leaves an address that already has it alone", () => {
    expect(withSandboxParam("?url=x&sandbox")).toBe("?url=x&sandbox");
    expect(withSandboxParam("?sandbox=")).toBe("?sandbox=");
  });
});

describe("rememberSandboxLogin / takeSandboxLogin", () => {
  it("keeps the authorize URL's state for exactly one later read", () => {
    rememberSandboxLogin("https://api-dandi.sandbox.emberarchive.org/oauth/authorize/?client_id=x&state=abc");
    expect(sessionStorage.getItem(SANDBOX_LOGIN_KEY)).toBe("abc");
    expect(takeSandboxLogin()).toBe("abc");
    expect(takeSandboxLogin()).toBe(null);
  });

  it("keeps the key it is read back under", () => {
    // A sandbox sign-in mid-redirect across a deploy is matched under this name.
    expect(SANDBOX_LOGIN_KEY).toBe("clip-extractor.sandbox-login.v1");
  });
});

describe("listSandboxIncomingDandisets", () => {
  it("offers every Incoming dataset the account owns there, in title order, asking no admin check", async () => {
    const archive = routeFetch([
      {
        match: `${EMBER_SANDBOX_INSTANCE.api}/dandisets/?user=me&embargoed=true&page_size=1000`,
        respond: () =>
          jsonResponse({
            results: [
              { identifier: "000002", draft_version: { name: "Incoming: Zebra Lab" }, embargo_status: "EMBARGOED" },
              { identifier: "000003", draft_version: { name: "Not a staging dataset" }, embargo_status: "EMBARGOED" },
              { identifier: "000001", draft_version: { name: "Incoming: Ant Lab" }, embargo_status: "OPEN" },
            ],
          }),
      },
    ]);
    vi.stubGlobal("fetch", archive);
    const cfg = { api: EMBER_SANDBOX_INSTANCE.api, web: EMBER_SANDBOX_INSTANCE.web, accessToken: "tok", dandisetId: "" };
    expect(await listSandboxIncomingDandisets(cfg)).toEqual({
      datasets: [
        { identifier: "000001", title: "Incoming: Ant Lab", embargoed: false },
        { identifier: "000002", title: "Incoming: Zebra Lab", embargoed: true },
      ],
      unverified: 0,
    });
    expect(archive.calls).toHaveLength(1);
  });
});
