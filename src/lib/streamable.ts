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
// For the containers below the download is futile as well as expensive, since none of the backends
// can open them once they have arrived. So a remote source is judged on what it is and how big it
// is, up front, rather than after a gigabyte has already been spent on it.

/**
 * The most of a remote video the app will read in one go — as a whole-file download, or as the
 * range reads that amount to one. It is a ceiling on what a browser tab can hold rather than a
 * preference: the bytes live in memory as a Blob, and ffmpeg.wasm addresses them 32 bits at a time.
 */
export const WHOLE_FILE_LIMIT_BYTES = 1024 * 1024 * 1024;

/**
 * Containers a remote video cannot be opened from without reading all of it.
 *
 * Two kinds of file end up here. AVI, the MPEG program-stream family, ASF/WMV, Flash, RealMedia and
 * the rest are containers mediabunny does not parse at all, so opening one means the whole-file
 * fallback — which then fails in sleap-io.js's backends too, since those read MP4 and nothing else.
 * MPEG transport streams do open, but carry no index and no recorded duration, so every frame's
 * timestamp has to be enumerated packet by packet: the same whole file, read as thousands of range
 * requests instead of as one download.
 *
 * Everything not named here is treated as streamable until it proves otherwise. A container is only
 * half of what decides that — an MP4 written with its index at the end of the file streams no
 * better than an AVI — and the file itself answers that question when it is opened, so the list
 * stays to what is known in advance rather than guessing from an extension.
 */
const UNSEEKABLE_CONTAINERS = new Set([
  "avi",
  "divx",
  "dv",
  "flv",
  "m1v",
  "m2t",
  "m2ts",
  "m2v",
  "mod",
  "mpe",
  "mpeg",
  "mpg",
  "mts",
  "mxf",
  "ogv",
  "rm",
  "rmvb",
  "ts",
  "vob",
  "wmv",
  "asf",
]);

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
 * unrecognized: what the file turns out to be is settled when it is opened. */
export function streamsEfficiently(nameOrUrl: string): boolean {
  return !UNSEEKABLE_CONTAINERS.has(containerOf(nameOrUrl));
}

/** Where a video that will not open is re-encoded into one that will. Named in every refusal:
 * nobody is helped by being told only that their file cannot be read. */
export const ENCODING_HELPER_URL = "https://encoding-helper.emberarchive.org";

/** Separates a message's paragraphs. What the page breaks a refusal into lines on, and no more
 * than a blank line anywhere else it is read. */
export const PARAGRAPH = "\n\n";

/** How to get out of this, its own paragraph at the end of every refusal. The link is written in
 * markdown because these messages are read in the console and in a `title` as well as on the page,
 * where it becomes a real link on its way in (see ui/linkify.ts). Exported for {@link loadTimeoutRefusal}
 * below, which is not a refusal decided up front like the rest of this module but one discovered
 * only once an open that looked fine on paper has actually been tried. */
export const ADVICE = `Please use the [Encoding Helper](${ENCODING_HELPER_URL}) to improve the video accessibility.`;

/** What every refusal opens with. Deliberately says nothing about the container: what a person can
 * do about the file is the same either way, and the extension is already in the name beside it. */
const CANNOT_STREAM = "cannot be opened efficiently through streaming";

/**
 * Why a remote source will not be opened at all, or null when it will be. `size` is the file's byte
 * count where the archive or the server has reported one, and null when nobody has.
 *
 * A file in one of the {@link UNSEEKABLE_CONTAINERS} costs its whole self to open, so what is
 * really being asked is whether the app is willing to read that much. A small one it will, since
 * the fallback that downloads it is quick and the failure it may end in is quicker still. A large
 * one it will not — and neither will it for a size nobody has reported, which is the same thing as
 * an unbounded one.
 */
export function unstreamableRefusal(name: string, size: number | null): string | null {
  if (streamsEfficiently(name)) return null;
  const opening = `Files such as this ${CANNOT_STREAM}`;
  if (size === null) {
    return `${opening}, and nothing says how large this one is, so there is no knowing what opening it would cost.${PARAGRAPH}${ADVICE}`;
  }
  if (size <= WHOLE_FILE_LIMIT_BYTES) return null;
  return `${opening}, and at ${bytes(size)} this one is past the ${bytes(WHOLE_FILE_LIMIT_BYTES)} limit on a whole-file download.${PARAGRAPH}${ADVICE}`;
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

/**
 * How long a video that passed every up-front check may take to actually open before the attempt is
 * judged stuck rather than merely slow.
 *
 * Everything above this decides whether a source is worth opening at all, from its container and
 * its declared size — and once a file clears those, the app believes it should just play. The
 * backends it is handed to either produce a frame or fail outright, ordinarily within moments, so a
 * source that instead sits doing neither — a network request nothing ever answers, a decoder handed
 * a header it waits on the rest of forever — looks identical to a normal wait for as long as nobody
 * cuts it off. Thirty seconds is a bet that nothing this app opens well should ever need longer.
 */
export const LOAD_TIMEOUT_MS = 30_000;

/**
 * Why a video that looked fine on paper was given up on partway through opening it.
 *
 * Unlike the rest of this module's refusals, nothing about the file said this was coming — its
 * container streams, its size is within every limit — so the wording says only that the wait ran
 * out, not what specifically went wrong: that is for whatever the failed attempt itself logged.
 */
export function loadTimeoutRefusal(name: string): string {
  const seconds = LOAD_TIMEOUT_MS / 1000;
  return (
    `${name} could not be opened within ${seconds} seconds. This usually means it holds a codec ` +
    `nothing here can decode, or that the connection to it stalled outright.${PARAGRAPH}${ADVICE}`
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
