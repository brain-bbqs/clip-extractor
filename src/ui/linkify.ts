// Putting a message on the page: its paragraphs as paragraphs, and the link in it as a link.
//
// The app's messages are written once and read in three places — the stage, the browse pane's
// status line, and the browser console — so they are written as text: blank lines between
// paragraphs, and a link in markdown, both of which read as themselves wherever there is no DOM to
// render them into. This is what renders them where there is one, without any of it being parsed
// as HTML.
//
// A link's destination is taken from the list of URLs the app owns rather than from the message. A
// message is not all the app's own words: it can quote a file name taken from the `?url=`
// parameter, or an error a server wrote, and honouring whatever destination appeared in it would
// let a crafted link put its own clickable target on the page under this app's name. A markdown
// link to anywhere else is left as the text it was written as, which hides nothing and clicks
// nowhere.

/** `[label](url)`, the one piece of markup a message may carry. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** A run of a paragraph: either text, or a link with the label to show it as. */
export interface MessagePart {
  text: string;
  url: string | null;
}

/** One paragraph's parts, links resolved against `urls`, in order. */
export function splitParagraph(text: string, urls: readonly string[]): MessagePart[] {
  const parts: MessagePart[] = [];
  let at = 0;
  const push = (run: string): void => {
    if (run) parts.push(...splitOnBareUrls(run, urls));
  };
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [whole, label, target] = match;
    push(text.slice(at, match.index));
    // The href is this list's entry, not the message's copy of it: the two read the same, and only
    // one of them is the app's own word.
    const owned = urls.find((url) => url === target);
    if (owned) parts.push({ text: label, url: owned });
    else parts.push({ text: whole, url: null });
    at = match.index + whole.length;
  }
  push(text.slice(at));
  return parts;
}

/** The same for a message that writes its URL out in full rather than marking it up. */
function splitOnBareUrls(text: string, urls: readonly string[]): MessagePart[] {
  const parts: MessagePart[] = [];
  let rest = text;
  for (;;) {
    // The earliest known URL in what is left, the longest winning a tie so a URL that is a prefix
    // of another cannot cut it short.
    let at = -1;
    let found: string | null = null;
    for (const url of urls) {
      if (!url) continue;
      const foundAt = rest.indexOf(url);
      if (foundAt < 0) continue;
      if (at < 0 || foundAt < at || (foundAt === at && url.length > (found?.length ?? 0))) {
        at = foundAt;
        found = url;
      }
    }
    if (at < 0 || !found) break;
    if (at > 0) parts.push({ text: rest.slice(0, at), url: null });
    parts.push({ text: found, url: found });
    rest = rest.slice(at + found.length);
  }
  if (rest) parts.push({ text: rest, url: null });
  return parts;
}

/** A message's paragraphs, split on the blank lines between them. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Fills `el` with `text`: a `<p class="message-line">` per paragraph, an anchor per owned link, and
 * a text node for everything else. Nothing is ever assigned as HTML, so a message quoting a
 * server's own words puts them on the page as the text they are, markup and all.
 */
export function setMessage(el: HTMLElement, text: string, urls: readonly string[]): void {
  el.replaceChildren(
    ...paragraphsOf(text).map((paragraph) => {
      const p = document.createElement("p");
      p.className = "message-line";
      p.append(
        ...splitParagraph(paragraph, urls).map((part) => {
          if (!part.url) return document.createTextNode(part.text);
          const a = document.createElement("a");
          a.href = part.url;
          a.textContent = part.text;
          a.target = "_blank";
          a.rel = "noopener";
          return a;
        }),
      );
      return p;
    }),
  );
}
