import { describe, expect, it } from "vitest";
import { setTextWithLinks, splitOnUrls } from "../../src/ui/linkify";

const HELPER = "https://encoding-helper.emberarchive.org";
const LINKS = [HELPER];

describe("splitOnUrls", () => {
  it("leaves a message with no known URL in it in one piece", () => {
    expect(splitOnUrls("Nothing to click here.", LINKS)).toEqual([{ text: "Nothing to click here.", url: null }]);
  });

  it("separates a known URL from the words either side of it", () => {
    expect(splitOnUrls(`Use ${HELPER} now`, LINKS)).toEqual([
      { text: "Use ", url: null },
      { text: HELPER, url: HELPER },
      { text: " now", url: null },
    ]);
  });

  it("keeps the bracket a URL is written inside out of the URL", () => {
    const parts = splitOnUrls(`Please use the Encoding Helper (${HELPER}) to re-encode it.`, LINKS);
    expect(parts[1].url).toBe(HELPER);
    expect(parts[2].text).toBe(") to re-encode it.");
  });

  it("leaves a URL the app does not own as the text it is", () => {
    const text = "Loading https://videos.test/clip.mp4 failed";
    expect(splitOnUrls(text, LINKS)).toEqual([{ text, url: null }]);
  });

  it("links every occurrence, not only the first", () => {
    expect(splitOnUrls(`${HELPER} and ${HELPER}`, LINKS).filter((p) => p.url)).toHaveLength(2);
  });
});

describe("setTextWithLinks", () => {
  it("puts the text on the page with the URL as a link that opens away from the app", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, `Please use the Encoding Helper (${HELPER}) to fix it.`, LINKS);
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe(HELPER);
    expect(link?.textContent).toBe(HELPER);
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener");
    expect(el.textContent).toBe(`Please use the Encoding Helper (${HELPER}) to fix it.`);
  });

  it("replaces what was there before rather than adding to it", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, "first", LINKS);
    setTextWithLinks(el, "second", LINKS);
    expect(el.textContent).toBe("second");
  });

  it("puts a server's own words on the page as text, markup and all", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, `HTTP 500: <img src=x onerror="alert(1)">`, LINKS);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe(`HTTP 500: <img src=x onerror="alert(1)">`);
  });

  it("refuses a destination the app did not choose, which a crafted ?url= could otherwise supply", () => {
    const el = document.createElement("p");
    // The name a `?url=` parameter is loaded under is the tail of that URL, so it can carry one of
    // its own — and a clickable link to somewhere else, drawn in this app's own message, is exactly
    // what nobody should be able to put there.
    setTextWithLinks(el, `"clip.mp4?next=https://evil.test" could not be loaded`, LINKS);
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.textContent).toContain("https://evil.test");
  });
});
