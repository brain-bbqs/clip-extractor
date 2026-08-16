// Putting a message on the page with the URL in it left clickable.
//
// The app's messages are written once and read in three places — the stage, the browse pane's
// status line, and the browser console — so they carry their URLs as plain text rather than as
// markup only one of those could use. This is what turns that text back into a link on the way
// into the DOM, without any of it being parsed as HTML.
//
// Only the URLs the app itself owns are linked, and a link's href is taken from that list rather
// than from the message. A message is not all the app's own words: it can quote a file name taken
// from the `?url=` parameter, or an error a server wrote, and linking whatever in it looks like a
// URL would let a crafted link put its own clickable destination on the page under this app's
// name. Anything else that reads as a URL is left as the text it is.

/** A message split into the runs of text and the known URLs between them, in order. */
export function splitOnUrls(text: string, urls: readonly string[]): { text: string; url: string | null }[] {
  const parts: { text: string; url: string | null }[] = [];
  let rest = text;
  for (;;) {
    // The earliest known URL in what is left, the longest winning a tie so a URL that is a prefix
    // of another cannot cut it short.
    let at = -1;
    let found: string | null = null;
    for (const url of urls) {
      if (!url) continue;
      const found_at = rest.indexOf(url);
      if (found_at < 0) continue;
      if (at < 0 || found_at < at || (found_at === at && url.length > (found?.length ?? 0))) {
        at = found_at;
        found = url;
      }
    }
    if (at < 0 || !found) break;
    if (at > 0) parts.push({ text: rest.slice(0, at), url: null });
    // The href is this list's entry, not the slice of the message it was found at: the two read the
    // same, and only one of them is the app's own word.
    parts.push({ text: found, url: found });
    rest = rest.slice(at + found.length);
  }
  if (rest) parts.push({ text: rest, url: null });
  return parts;
}

/**
 * Fills `el` with `text`, every occurrence of a URL in `urls` an anchor and everything else a text
 * node. Nothing is ever assigned as HTML, so a message quoting a server's own words puts them on
 * the page as the text they are, markup and all.
 */
export function setTextWithLinks(el: HTMLElement, text: string, urls: readonly string[]): void {
  el.replaceChildren(
    ...splitOnUrls(text, urls).map((part) => {
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
