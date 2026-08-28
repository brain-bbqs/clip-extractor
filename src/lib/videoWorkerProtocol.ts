import type { TechnicalDetail } from "./provenance";

// What the two halves of the worker-backed video source say to each other: lib/workerVideo.ts on the
// page's thread, lib/videoWorker.ts on its own. Kept in a module of its own so neither side can
// drift from the other, and so nothing but types crosses between them.
//
// Only a file already on the machine is opened this way. Reading a container's index is the work
// that used to hold the page's thread for as long as it took — long enough on a large recording that
// clicks were refused outright — and none of it waits on anything, so moving it is the only thing
// that makes the page answer while it runs. A streamed URL stays where it was: its reading is
// interleaved with network round trips that hand the thread back on their own, and the same open
// container is what a snippet is later trimmed out of (see lib/extract.ts's `extractStreamedClip`),
// which would have to cross this boundary too.

/** What the page needs to know about a source the moment it opens, all of it settled during the
 * indexing the worker just did. */
export interface OpenedVideo {
  numFrames: number;
  fps: number;
  width: number;
  height: number;
  shape: [number, number, number, number];
  /** What the container says about its own bitstream, for provenance sidecars — see
   * `StreamingVideoBackend.technical`. */
  technical: TechnicalDetail;
}

export interface OpenRequest {
  kind: "open";
  id: number;
  file: File;
  /** Decoded frames the worker may hold between handing them over — one read-ahead window's worth,
   * since every one of them is taken from it as soon as the window finishes. */
  cacheSize: number;
}

export interface FrameRequest {
  kind: "frame";
  id: number;
  index: number;
}

export interface PrefetchRequest {
  kind: "prefetch";
  id: number;
  lo: number;
  hi: number;
}

export interface FrameTimesRequest {
  kind: "frameTimes";
  id: number;
}

export type ToVideoWorker = OpenRequest | FrameRequest | PrefetchRequest | FrameTimesRequest;

export interface OpenedMessage {
  kind: "opened";
  id: number;
  video: OpenedVideo;
}

/** How much of the file the index has read so far, as it is read: the figure the picker counts up
 * while somebody waits. Sent unasked, so it carries the id of the open it belongs to. */
export interface IndexProgressMessage {
  kind: "indexProgress";
  id: number;
  bytesRead: number;
}

/** One decoded frame, handed over rather than copied: the bitmap is transferred, so the worker no
 * longer holds it. Sent in answer to a frame request, and unasked for every frame a read-ahead
 * decodes on its way past — those carry the read-ahead's id. */
export interface FrameMessage {
  kind: "frame";
  id: number;
  index: number;
  bitmap: ImageBitmap | null;
}

export interface PrefetchedMessage {
  kind: "prefetched";
  id: number;
}

/** Every frame's timestamp in the order they are indexed, or null where the container's own rate
 * describes them and decode order is already display order. A typed array rather than a plain one:
 * a long recording has millions of these, and this way they are moved rather than copied. */
export interface FrameTimesMessage {
  kind: "frameTimes";
  id: number;
  times: Float64Array | null;
}

export interface FailureMessage {
  kind: "failed";
  id: number;
  message: string;
}

export type FromVideoWorker = OpenedMessage | IndexProgressMessage | FrameMessage | PrefetchedMessage | FrameTimesMessage | FailureMessage;
