import { describe, expect, it } from "vitest";
import { ApiError, friendlyError } from "../../src/lib/errors";

describe("ApiError", () => {
  it("carries the HTTP status alongside the message, named as its own error type", () => {
    const e = new ApiError("GET /info failed", 500);
    expect(e.message).toBe("GET /info failed");
    expect(e.status).toBe(500);
    expect(e.name).toBe("ApiError");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("friendlyError", () => {
  it("turns a 401 into the one action that fixes it: signing out and back in", () => {
    expect(friendlyError(new ApiError("GET /users/me/ failed with HTTP 401", 401))).toBe(
      "Authentication failed: please sign out and sign in again.",
    );
  });

  it("says what a 403 means for this app: the account cannot add assets", () => {
    expect(friendlyError(new ApiError("POST /assets/ failed with HTTP 403", 403))).toBe(
      "Permission denied: your account cannot add assets to this dataset.",
    );
  });

  it("points a 404 at the dataset and its draft, the things worth checking", () => {
    expect(friendlyError(new ApiError("GET /versions/draft/ failed with HTTP 404", 404))).toBe(
      "Not found: check that the dataset still exists and has a draft version.",
    );
  });

  it("passes any other API failure through as its own message", () => {
    expect(friendlyError(new ApiError("PUT /assets/ failed with HTTP 500", 500))).toBe("PUT /assets/ failed with HTTP 500");
  });

  it("passes a plain Error through as its own message", () => {
    expect(friendlyError(new Error("network down"))).toBe("network down");
  });

  it("stringifies whatever else was thrown, rather than showing [object Object]", () => {
    expect(friendlyError("just a string")).toBe("just a string");
    expect(friendlyError(42)).toBe("42");
  });
});
