import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_URL_STATE, readUrlState, stashUrlState, takeStashedUrlState, writeUrlState, type UrlState } from "../../src/lib/urlState";

const VIDEO = "https://videos.test/clip.mp4";

/** A session with everything a link can carry, so a test only has to name what it is about. */
function session(overrides: Partial<UrlState> = {}): UrlState {
  return { ...EMPTY_URL_STATE, url: VIDEO, inF: 10, outF: 40, frame: 25, description: "a bout", ...overrides };
}

describe("readUrlState", () => {
  it("reads the whole session out of the query string", () => {
    const state = readUrlState("?url=https%3A%2F%2Fvideos.test%2Fclip.mp4&mode=frame&in=10&out=40&frame=25&description=a%20bout");
    expect(state).toEqual({ url: VIDEO, pose: null, mode: "frame", inF: 10, outF: 40, frame: 25, description: "a bout" });
  });

  it("reads nothing out of an empty address", () => {
    expect(readUrlState("")).toEqual(EMPTY_URL_STATE);
  });

  it("takes ?slp= as the older spelling of ?pose=, and prefers ?pose= when both are given", () => {
    expect(readUrlState("?slp=https://poses.test/labels.slp").pose).toBe("https://poses.test/labels.slp");
    expect(readUrlState("?pose=https://poses.test/new.slp&slp=https://poses.test/old.slp").pose).toBe("https://poses.test/new.slp");
  });

  it("defaults to the snippet selector, which is the one the player opens in", () => {
    expect(readUrlState("?url=x").mode).toBe("video");
    expect(readUrlState("?url=x&mode=nonsense").mode).toBe("video");
    expect(readUrlState("?url=x&mode=frame").mode).toBe("frame");
  });

  it("ignores a frame index that is not a frame index", () => {
    expect(readUrlState("?in=-4&out=twelve&frame=1.5").inF).toBe(null);
    expect(readUrlState("?in=-4&out=twelve&frame=1.5").outF).toBe(null);
    expect(readUrlState("?in=-4&out=twelve&frame=1.5").frame).toBe(null);
  });

  it("keeps a description's own whitespace, which is the note somebody typed", () => {
    expect(readUrlState("?description=first%20line%0A%0Alast%20line").description).toBe("first line\n\nlast line");
  });
});

describe("writeUrlState", () => {
  it("writes the whole session, and reads back what it wrote", () => {
    const before = session({ pose: "https://poses.test/labels.slp", mode: "frame" });
    expect(readUrlState(writeUrlState("", before))).toEqual(before);
  });

  it("leaves the address empty while nothing remote is loaded, marks and description included", () => {
    expect(writeUrlState("", session({ url: null }))).toBe("");
  });

  it("takes down a previous session's params rather than leaving a stale address behind", () => {
    expect(writeUrlState("?url=https://videos.test/old.mp4&in=1&out=2&slp=https://poses.test/old.slp", EMPTY_URL_STATE)).toBe("");
  });

  it("leaves params it does not own exactly where they were", () => {
    expect(writeUrlState("?code=abc&url=https://videos.test/old.mp4", session({ inF: null, outF: null, frame: null, description: "" }))).toBe(
      `?code=abc&url=${encodeURIComponent(VIDEO)}`,
    );
  });

  it("carries frame 0 only where it is the selection, since every video opens on it", () => {
    expect(readUrlState(writeUrlState("", session({ frame: 0 }))).frame).toBe(null);
    expect(readUrlState(writeUrlState("", session({ frame: 0, mode: "frame" }))).frame).toBe(0);
  });

  it("says nothing about the snippet selector, which is the default the player is already on", () => {
    expect(writeUrlState("", session({ mode: "video" })).includes("mode=")).toBe(false);
  });

  it("does not repeat itself when the same session is written twice", () => {
    const once = writeUrlState("", session());
    expect(writeUrlState(once, session())).toBe(once);
  });
});

describe("the session held across signing in", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("hands the held address back once, and only once", () => {
    stashUrlState("?url=https://videos.test/clip.mp4");
    expect(takeStashedUrlState()).toBe("?url=https://videos.test/clip.mp4");
    expect(takeStashedUrlState()).toBe(null);
  });

  it("holds nothing for a page that had nothing in its address", () => {
    stashUrlState("?url=https://videos.test/clip.mp4");
    stashUrlState("");
    expect(takeStashedUrlState()).toBe(null);
  });
});
