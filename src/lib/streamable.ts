import { bytes } from "./format";

// Which remote videos are worth opening, decided before anything is opened.
//
// A URL is opened by reading its container index over range requests (lib/streaming.ts), and only
// the bytes a selection actually needs are read after that. When the index cannot be read that way
// the app falls back to fetching the whole file, which is fine for a clip and ruinous for a
// recording: every byte crosses the network, is then held in memory as one Blob, and has to fit in
// ffmpeg.wasm's 32-bit address space besides. An archived recording can be hundreds of gigabytes,
// so that fallback is not a slower path to the same result — it is a tab that fills memory until it
// dies.
//
// For some of the containers below the download does not even end in a playable video: nothing in
// the browser parses them, so the file has to be re-encoded once it has arrived, which costs more
// again and can only be done to a much smaller file. So a remote source is judged on what it is and
// how big it is, up front, rather than after a gigabyte has already been spent on it.

/**
 * The most of a remote video the app will read in one go — as a whole-file download, or as the
 * range reads that amount to one. It is a ceiling on what a browser tab can hold rather than a
 * preference: the bytes live in memory as a Blob, and ffmpeg.wasm addresses them 32 bits at a time.
 */
export const WHOLE_FILE_LIMIT_BYTES = 1024 * 1024 * 1024;

/**
 * The most of a video the app will convert into a playable one in the browser.
 *
 * A file no backend can open is put through ffmpeg.wasm and re-encoded into an MP4 (see
 * lib/ffmpeg.ts). That runs in a 32-bit address space holding the whole source, every frame it
 * decodes and the MP4 it writes at once, so the ceiling is lower than the one on a download: a file
 * past it would spend its whole conversion filling memory before failing.
 */
export const TRANSCODE_LIMIT_BYTES = 256 * 1024 * 1024;

/**
 * Containers nothing in the browser will parse, so a file in one has to be converted before it can
 * be played at all.
 *
 * AVI, the MPEG program-stream family, ASF/WMV, Flash, RealMedia and the rest are containers
 * mediabunny does not read, and sleap-io.js's backends are no help either since those read MP4 and
 * nothing else. The whole file is fetched, none of it opens, and what is left is to re-encode it —
 * which is why these are held to {@link TRANSCODE_LIMIT_BYTES} rather than to the download limit.
 */
const UNREADABLE_CONTAINERS = new Set([
  "asf",
  "avi",
  "divx",
  "dv",
  "flv",
  "m1v",
  "m2v",
  "mod",
  "mpe",
  "mpeg",
  "mpg",
  "mxf",
  "rm",
  "rmvb",
  "vob",
  "wmv",
]);

/**
 * Containers that open but cost the whole file to index.
 *
 * MPEG transport streams and Ogg carry no index and no recorded duration, so every frame's
 * timestamp has to be enumerated packet by packet: the same whole file, read as thousands of range
 * requests instead of as one download. They do open once they have arrived, so these are held to
 * the download limit alone.
 */
const UNINDEXED_CONTAINERS = new Set(["m2t", "m2ts", "mts", "ogv", "ts"]);

/** The lowercase extension of a file name or URL, or "" when it has none. Query strings and
 * fragments are dropped first: a signed bucket URL carries its signature after the `?`, and an
 * asset URL naming no file at all must come back empty rather than as its last path segment. */
export function containerOf(nameOrUrl: string): string {
  const path = nameOrUrl.split("#")[0].split("?")[0];
  const file = path.split("/").pop() ?? "";
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) return "";
  return file.slice(dot + 1).toLowerCase();
}

/** Whether a name or URL is in a container that can be read a piece at a time. True for anything
 * unrecognized: what the file turns out to be is settled when it is opened.
 *
 * A container is only half of what decides that — an MP4 written with its index at the end of the
 * file streams no better than an AVI — and the file itself answers that question when it is opened,
 * so the lists above stay to what is known in advance rather than guessing from an extension. */
export function streamsEfficiently(nameOrUrl: string): boolean {
  const container = containerOf(nameOrUrl);
  return !UNREADABLE_CONTAINERS.has(container) && !UNINDEXED_CONTAINERS.has(container);
}

/** Whether a name or URL is in a container that has to be converted before anything can play it.
 * False for anything unrecognized, the same way {@link streamsEfficiently} is generous: a file that
 * turns out to need converting after all is found out when every backend has refused it. */
export function needsConversion(nameOrUrl: string): boolean {
  return UNREADABLE_CONTAINERS.has(containerOf(nameOrUrl));
}

/** Where a video that will not open is re-encoded into one that will. Named in every refusal:
 * nobody is helped by being told only that their file cannot be read. */
export const ENCODING_HELPER_URL = "https://encoding-helper.emberarchive.org";

/** Separates a message's paragraphs. What the page breaks a refusal into lines on, and no more
 * than a blank line anywhere else it is read. */
export const PARAGRAPH = "\n\n";

/** How to get out of this, its own paragraph at the end of every refusal. The link is written in
 * markdown because these messages are read in the console and in a `title` as well as on the page,
 * where it becomes a real link on its way in (see ui/linkify.ts). Exported for lib/ffmpeg.ts's own
 * refusal, discovered only once a conversion is already running rather than known up front like the
 * refusals in this module. */
export const ADVICE = `Please use the [Encoding Helper](${ENCODING_HELPER_URL}) to improve the video accessibility.`;

/** What every refusal opens with. Deliberately says nothing about the container: what a person can
 * do about the file is the same either way, and the extension is already in the name beside it. */
const CANNOT_STREAM = "cannot be opened efficiently through streaming";

/**
 * The most of a file in `container` the app will take on, and the words for what that ceiling is a
 * ceiling on. A container the browser cannot parse has to be converted after it is downloaded, and
 * that conversion, not the download, is what runs out first.
 */
function ceilingFor(nameOrUrl: string): { limit: number; what: string } {
  return needsConversion(nameOrUrl)
    ? { limit: TRANSCODE_LIMIT_BYTES, what: "converting one in the browser" }
    : { limit: WHOLE_FILE_LIMIT_BYTES, what: "a whole-file download" };
}

/**
 * Why a remote source will not be opened at all, or null when it will be. `size` is the file's byte
 * count where the archive or the server has reported one, and null when nobody has.
 *
 * A file in one of the containers above costs its whole self to open, and one the browser cannot
 * parse costs a conversion on top of that, so what is really being asked is whether the app is
 * willing to spend that much. On a small file it is, since the download that follows is quick and
 * the conversion is bounded by what a browser tab can hold. On a large one it is not — and neither
 * is it for a size nobody has reported, which is the same thing as an unbounded one.
 */
export function unstreamableRefusal(name: string, size: number | null): string | null {
  if (streamsEfficiently(name)) return null;
  const opening = `Files such as this ${CANNOT_STREAM}`;
  if (size === null) {
    return `${opening}, and nothing says how large this one is, so there is no knowing what opening it would cost.${PARAGRAPH}${ADVICE}`;
  }
  const { limit, what } = ceilingFor(name);
  if (size <= limit) return null;
  return `${opening}, and at ${bytes(size)} this one is past the ${bytes(limit)} limit on ${what}.${PARAGRAPH}${ADVICE}`;
}

/**
 * Why a file that arrived in one piece will not be converted into a playable one, or null when it
 * will be. The size that matters here is the file's own, whatever the name on it said: bytes
 * downloaded from a URL that named no container at all still have to fit through ffmpeg.wasm.
 */
export function conversionRefusal(name: string, size: number): string | null {
  if (size <= TRANSCODE_LIMIT_BYTES) return null;
  return (
    `${name} is in a container nothing in the browser can read, and at ${bytes(size)} it is past ` +
    `the ${bytes(TRANSCODE_LIMIT_BYTES)} limit on converting one here.${PARAGRAPH}${ADVICE}`
  );
}

/**
 * Why a source that could not be streamed will not be downloaded whole either, or null when it
 * will be. The check the container list cannot make: an MKV holding a codec the browser has no
 * decoder for, or an MP4 whose index sits at the end of the file, is in a perfectly streamable
 * container and still leaves the whole file as the only way to read it.
 *
 * Which of those it was is not said here. It is a sentence about container internals in the middle
 * of a message whose point is that the file is too large and where to have it re-encoded, and it
 * leaves neither of those any clearer. The streaming open's own words go to the console, which is
 * where the question it answers gets asked.
 */
export function wholeFileRefusal(size: number | null): string | null {
  if (size === null || size <= WHOLE_FILE_LIMIT_BYTES) return null;
  // The file is named by the line above this one wherever this is shown, so it opens on what is
  // wrong rather than repeating whose fault it is.
  return (
    `This file ${CANNOT_STREAM}, and at ${bytes(size)} it is past the ` +
    `${bytes(WHOLE_FILE_LIMIT_BYTES)} limit on a whole-file download.${PARAGRAPH}${ADVICE}`
  );
}

/** The total size a `Content-Range` header reports, or null when it reports none. The header reads
 * `bytes 0-0/1234`, and a server that does not know the total writes `*` in its place. */
export function parseContentRangeSize(header: string | null): number | null {
  const total = header?.split("/")[1]?.trim();
  if (!total || total === "*") return null;
  const size = Number(total);
  return Number.isFinite(size) && size >= 0 ? size : null;
}

/** The size a response says the whole file is: from `Content-Range` when it is a partial answer,
 * and from `Content-Length` when it is the whole thing. */
function sizeFromResponse(resp: Response): number | null {
  const ranged = parseContentRangeSize(resp.headers.get("content-range"));
  if (ranged !== null) return ranged;
  // A 206 answering a one-byte probe declares a length of 1, which is the length of the answer
  // rather than of the file.
  if (resp.status === 206) return null;
  const length = Number(resp.headers.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length : null;
}

/**
 * How large a server says the file at `url` is, or null when it will not say.
 *
 * Asked with a HEAD first, and then — for the hosts that answer HEAD with a 403, or answer it
 * without a length, both of which signed bucket URLs do — with a request for the file's first byte,
 * whose `Content-Range` names the total. Never throws for a network answer it does not like: not
 * knowing the size is an answer this module has a rule for.
 */
export async function remoteFileSize(url: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const head = await fetch(url, { method: "HEAD", signal });
    const size = head.ok ? sizeFromResponse(head) : null;
    if (size !== null) return size;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  try {
    const probe = await fetch(url, { headers: { Range: "bytes=0-0" }, signal });
    return probe.ok ? sizeFromResponse(probe) : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}
