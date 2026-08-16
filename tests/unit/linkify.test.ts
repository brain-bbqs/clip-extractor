import { describe, expect, it } from "vitest";
import { setTextWithLinks, splitOnUrls } from "../../src/ui/linkify";

describe("splitOnUrls", () => {
  it("leaves a message with no URL in it in one piece", () => {
    expect(splitOnUrls("Nothing to click here.")).toEqual([{ text: "Nothing to click here.", url: null }]);
  });

  it("separates a URL from the words either side of it", () => {
    expect(splitOnUrls("Use the helper at https://helper.test now")).toEqual([
      { text: "Use the helper at ", url: null },
      { text: "https://helper.test", url: "https://helper.test" },
      { text: " now", url: null },
    ]);
  });

  it("stops a URL at the bracket it is written inside, not at the one after it", () => {
    const parts = splitOnUrls("Please use the Encoding Helper (https://encoding-helper.emberarchive.org) to re-encode it.");
    expect(parts[1].url).toBe("https://encoding-helper.emberarchive.org");
    expect(parts[2].text).toBe(") to re-encode it.");
  });

  it("leaves the sentence's full stop out of the URL it follows", () => {
    const parts = splitOnUrls("Read https://helper.test/docs.");
    expect(parts[1].url).toBe("https://helper.test/docs");
    expect(parts[2].text).toBe(".");
  });
});

describe("setTextWithLinks", () => {
  it("puts the text on the page with the URL as a link that opens away from the app", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, "Please use the Encoding Helper (https://encoding-helper.emberarchive.org) to fix it.");
    const link = el.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://encoding-helper.emberarchive.org");
    expect(link?.textContent).toBe("https://encoding-helper.emberarchive.org");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener");
    expect(el.textContent).toBe("Please use the Encoding Helper (https://encoding-helper.emberarchive.org) to fix it.");
  });

  it("replaces what was there before rather than adding to it", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, "first");
    setTextWithLinks(el, "second");
    expect(el.textContent).toBe("second");
  });

  it("puts a server's own words on the page as text, markup and all", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, `HTTP 500: <img src=x onerror="alert(1)">`);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe(`HTTP 500: <img src=x onerror="alert(1)">`);
  });

  it("links nothing but https, so a scripted href cannot be smuggled into a message", () => {
    const el = document.createElement("p");
    setTextWithLinks(el, "javascript:alert(1) and http://plain.test");
    expect(el.querySelectorAll("a")).toHaveLength(0);
  });
});
