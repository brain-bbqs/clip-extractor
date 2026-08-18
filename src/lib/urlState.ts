import type { SelectorMode } from "./types";

// What the address bar carries, so that a session is a link.
//
// Everything the page can put back on its own — the remote video and pose file it was streaming,
// the marks made in them, and the description typed for the delivery — is written into the query
// string as it changes and read back on the next load. A reload, a bookmark and a link pasted to a
// colleague are then the same thing: whoever opens it lands on the frames that were being talked
// about rather than on an empty stage and a URL to paste by hand.
//
// Only a *remote* source can travel this way. A local file sits behind a picker no page can re-open
// on its own, so a local session writes nothing at all rather than writing marks into a link that
// would open on nothing. `?url=` and `?pose=` (and `?slp=`, its older spelling) predate this and
// still mean what they always did — this only adds the rest of the session beside them, and keeps
// them up to date rather than leaving them at whatever was first opened.

/** The part of a session a link can carry. */
export interface UrlState {
  /** The remote video being streamed, or null for a local file (or nothing loaded). */
  url: string | null;
  /** The remote pose file loaded over it, or null for a local one (or none). */
  pose: string | null;
  mode: SelectorMode;
  /** The snippet's ends, null for an end nothing has been marked at. */
  inF: number | null;
  outF: number | null;
  /** Where the playhead is — which in frame mode is the selection itself. */
  frame: number | null;
  description: string;
}

/** Nothing loaded and nothing marked: what an address with none of these params describes. */
export const EMPTY_URL_STATE: UrlState = { url: null, pose: null, mode: "video", inF: null, outF: null, frame: null, description: "" };

/** The params this module owns. Anything else in the query string belongs to somebody else — the
 * OAuth callback's `code`/`state` most of all — and is carried through untouched. */
const OWNED_PARAMS = ["url", "pose", "slp", "mode", "in", "out", "frame", "description"] as const;

/** Where the query string is kept across the sign-in round trip (see stashUrlState). */
const STASH_KEY = "clip-extractor.url-state.v1";

function text(params: URLSearchParams, key: string): string | null {
  return params.get(key)?.trim() || null;
}

/** A frame index as a param: a non-negative integer, or null for anything else. Bounds against the
 * video itself are the caller's, since nothing here knows how long the recording is. */
function frameParam(params: URLSearchParams, key: string): number | null {
  const raw = text(params, key);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Reads a session out of a query string (`location.search`, with or without its leading `?`). */
export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  return {
    url: text(params, "url"),
    pose: text(params, "pose") ?? text(params, "slp"),
    // Snippet is the mode the player opens in, so only frame mode is worth a param.
    mode: text(params, "mode") === "frame" ? "frame" : "video",
    inF: frameParam(params, "in"),
    outF: frameParam(params, "out"),
    frame: frameParam(params, "frame"),
    description: params.get("description") ?? "",
  };
}

/**
 * The query string `state` should be reflected in, given the one currently in the bar.
 *
 * Params this module does not own keep their place and their value; the ones it does are rewritten
 * from `state` — including being dropped, so a local file loaded over a streamed one takes the
 * streamed one's link down with it rather than leaving a stale address behind.
 *
 * Nothing but the source is written without a source: marks and a description with no video named
 * beside them describe a recording the link cannot open, which is worse than an empty address.
 */
export function writeUrlState(search: string, state: UrlState): string {
  const params = new URLSearchParams(search);
  for (const key of OWNED_PARAMS) params.delete(key);
  if (state.url) {
    params.set("url", state.url);
    if (state.pose) params.set("pose", state.pose);
    if (state.mode === "frame") params.set("mode", "frame");
    if (state.inF !== null) params.set("in", String(state.inF));
    if (state.outF !== null) params.set("out", String(state.outF));
    // Frame 0 is where every video opens, so it is only worth carrying when it is the selection.
    if (state.frame !== null && (state.frame > 0 || state.mode === "frame")) params.set("frame", String(state.frame));
    if (state.description) params.set("description", state.description);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Keeps a query string across the sign-in round trip.
 *
 * Signing in leaves the page for the archive's authorize screen and comes back to the redirect URI
 * registered with it, which is the bare page address — a query string cannot ride along. So the one
 * being left behind is put here first, and taken back out on the load that returns, rather than
 * having a session end at the moment somebody signs in to upload it.
 */
export function stashUrlState(search: string): void {
  try {
    if (search) sessionStorage.setItem(STASH_KEY, search);
    else sessionStorage.removeItem(STASH_KEY);
  } catch (e) {
    console.warn("Could not hold the address across sign-in:", e);
  }
}

/** Reads back what stashUrlState held, clearing it: it is only ever good for the next load. */
export function takeStashedUrlState(): string | null {
  try {
    const held = sessionStorage.getItem(STASH_KEY);
    sessionStorage.removeItem(STASH_KEY);
    return held;
  } catch (e) {
    console.warn("Could not restore the address held across sign-in:", e);
    return null;
  }
}
