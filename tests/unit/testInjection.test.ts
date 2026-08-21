import { describe, expect, it } from "vitest";
import { mockSourcePath, readTestInjection } from "../../src/lib/testInjection";

describe("readTestInjection", () => {
  it("returns null when the page was not asked to fake anything", () => {
    expect(readTestInjection("")).toBeNull();
    expect(readTestInjection("?foo=bar")).toBeNull();
  });

  it("reads mock_sub and mock_ses off the query string", () => {
    expect(readTestInjection("?test&mock_video&mock_sub=01&mock_ses=02")).toMatchObject({ mockSub: "01", mockSes: "02" });
  });

  it("leaves both null when neither is given — the sub-unknown fallback case", () => {
    expect(readTestInjection("?test&mock_video")).toMatchObject({ mockSub: null, mockSes: null });
  });

  it("reads mock_sub alone, with no session", () => {
    expect(readTestInjection("?test&mock_video&mock_sub=1")).toMatchObject({ mockSub: "1", mockSes: null });
  });

  it("defaults mock_ready to off — the gated, 'describe it first' state mock_video alone previews", () => {
    expect(readTestInjection("?test&mock_video")).toMatchObject({ mockReady: false });
  });

  it("reads the bare mock_ready flag", () => {
    expect(readTestInjection("?test&mock_video&mock_ready")).toMatchObject({ mockReady: true });
  });
});

describe("mockSourcePath", () => {
  it("builds an archive-shaped path when mock_sub is given", () => {
    const injection = readTestInjection("?test&mock_video&mock_sub=1")!;
    expect(mockSourcePath(injection, "clip.webm")).toBe("sub-1/clip.webm");
  });

  it("includes the session segment too, when there is one", () => {
    const injection = readTestInjection("?test&mock_video&mock_sub=01&mock_ses=02")!;
    expect(mockSourcePath(injection, "clip.webm")).toBe("sub-01/ses-02/clip.webm");
  });

  it("returns null with no mock_sub, leaving the mock video's source unnamed (sub-unknown)", () => {
    const injection = readTestInjection("?test&mock_video")!;
    expect(mockSourcePath(injection, "clip.webm")).toBeNull();
  });
});
