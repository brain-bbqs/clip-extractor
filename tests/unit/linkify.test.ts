import { describe, expect, it } from "vitest";
import { paragraphsOf, setMessage, splitParagraph } from "../../src/ui/linkify";

const HELPER = "https://encoding-helper.emberarchive.org";
const LINKS = [HELPER];

describe("paragraphsOf", () => {
  it("breaks a message on its blank lines", () => {
    expect(paragraphsOf("one\n\ntwo\n\nthree")).toEqual(["one", "two", "three"]);
  });

  it("leaves a single-paragraph message as one", () => {
    expect(paragraphsOf("all of it")).toEqual(["all of it"]);
  });

  it("keeps a line break inside a paragraph out of the split", () => {
    expect(paragraphsOf("one\nstill one\n\ntwo")).toEqual(["one\nstill one", "two"]);
  });
});

describe("splitParagraph", () => {
  it("resolves a markdown link the app owns to its label and destination", () => {
    expect(splitParagraph(`Please use the [Encoding Helper](${HELPER}) to fix it.`, LINKS)).toEqual([
      { text: "Please use the ", url: null },
      { text: "Encoding Helper", url: HELPER },
      { text: " to fix it.", url: null },
    ]);
  });

  it("links a URL written out in full as well, since not every message marks one up", () => {
    expect(splitParagraph(`See ${HELPER} for more`, LINKS)).toEqual([
      { text: "See ", url: null },
      { text: HELPER, url: HELPER },
      { text: " for more", url: null },
    ]);
  });

  it("leaves a markdown link to anywhere else exactly as it was written", () => {
    const text = "[click here](https://evil.test) said the error";
    const parts = splitParagraph(text, LINKS);
    expect(parts.every((part) => part.url === null)).toBe(true);
    expect(parts.map((part) => part.text).join("")).toBe(text);
  });

  it("leaves a message with nothing to link in one piece", () => {
    expect(splitParagraph("Loading https://videos.test/clip.mp4 failed", LINKS)).toEqual([
      { text: "Loading https://videos.test/clip.mp4 failed", url: null },
    ]);
  });
});

describe("setMessage", () => {
  const refusal = [
    "recording.avi cannot be opened.",
    "Files such as this cannot be opened efficiently through streaming, and at 305.67 GB this one is past the 1.00 GB limit on a whole-file download.",
    `Please use the [Encoding Helper](${HELPER}) to improve the video accessibility.`,
  ].join("\n\n");

  it("puts each paragraph on its own line, in order", () => {
    const el = document.createElement("div");
    setMessage(el, refusal, LINKS);
    const lines = el.querySelectorAll("p.message-line");
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toBe("recording.avi cannot be opened.");
    expect(lines[1].textContent).toContain("305.67 GB");
    expect(lines[2].textContent).toBe("Please use the Encoding Helper to improve the video accessibility.");
  });

  it("shows the link by its name rather than by its URL", () => {
    const el = document.createElement("div");
    setMessage(el, refusal, LINKS);
    const link = el.querySelector("a");
    expect(link?.textContent).toBe("Encoding Helper");
    expect(link?.getAttribute("href")).toBe(HELPER);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener");
  });

  it("replaces what was there before rather than adding to it", () => {
    const el = document.createElement("div");
    setMessage(el, "first", LINKS);
    setMessage(el, "second", LINKS);
    expect(el.textContent).toBe("second");
  });

  it("puts a server's own words on the page as text, markup and all", () => {
    const el = document.createElement("div");
    setMessage(el, `HTTP 500: <img src=x onerror="alert(1)">`, LINKS);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe(`HTTP 500: <img src=x onerror="alert(1)">`);
  });

  it("refuses a destination the app did not choose, which a crafted ?url= could otherwise supply", () => {
    const el = document.createElement("div");
    // The name a `?url=` parameter is loaded under is the tail of that URL, so it can carry one of
    // its own — and a clickable link to somewhere else, drawn in this app's own message, is exactly
    // what nobody should be able to put there.
    setMessage(el, `"clip.mp4?next=https://evil.test" could not be loaded.`, LINKS);
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.textContent).toContain("https://evil.test");
  });
});
