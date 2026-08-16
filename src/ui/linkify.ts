// Putting a message on the page with the URL in it left clickable.
//
// The app's messages are written once and read in three places — the stage, the browse pane's
// status line, and the browser console — so they carry their URLs as plain text rather than as
// markup only one of those could use. This is what turns that text back into a link on the way
// into the DOM, without any of it being parsed as HTML.

/** Matches an `https://` URL up to the first character that cannot be part of one. Closing
 * brackets are excluded so a URL written inside parentheses does not swallow the one after it. */
const URL_PATTERN = /https:\/\/[^\s<>()[\]]+/g;

/** Trailing punctuation that ends the sentence rather than the URL. */
const TRAILING = /[.,;:!?]+$/;

/** A message split into the runs of text and the URLs between them, in order. */
export function splitOnUrls(text: string): { text: string; url: string | null }[] {
  const parts: { text: string; url: string | null }[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, "");
    const start = match.index;
    if (start > at) parts.push({ text: text.slice(at, start), url: null });
    parts.push({ text: url, url });
    at = start + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), url: null });
  return parts;
}

/**
 * Fills `el` with `text`, every `https://` URL in it an anchor and everything else a text node.
 *
 * Nothing is ever assigned as HTML: the text runs are text nodes and an anchor's href is the
 * matched URL itself, which the pattern above admits only when it starts `https://`. So a message
 * that quotes a server's own words cannot put markup — or a `javascript:` href — on the page.
 */
export function setTextWithLinks(el: HTMLElement, text: string): void {
  el.replaceChildren(
    ...splitOnUrls(text).map((part) => {
      if (!part.url) return document.createTextNode(part.text);
      const a = document.createElement("a");
      a.href = part.url;
      a.textContent = part.text;
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    }),
  );
}
