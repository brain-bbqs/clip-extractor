/// <reference lib="webworker" />
import { openStreamingBlob, type StreamingVideoBackend } from "./streaming";
import type { FrameMessage, FromVideoWorker, ToVideoWorker } from "./videoWorkerProtocol";

// The thread a local recording is opened on. Everything expensive about opening one happens here:
// the container header is parsed here, the frame index is worked out here, and frames are decoded
// here — so none of it is on the thread that has to answer a click. See videoWorkerProtocol.ts for
// what crosses between the two, and workerVideo.ts for the half of this that runs on the page.
//
// Nothing in here touches the DOM, and nothing may: a worker has no document. The backend it drives
// is the same one the page used to run in-process (lib/streaming.ts), which is why it has to stay
// free of the DOM as well.

const worker = self as unknown as DedicatedWorkerGlobalScope;

/** The open recording. One at a time: the page closes the last before opening the next, and a second
 * source in flight here would be a second one being decoded for nobody. */
let backend: StreamingVideoBackend | null = null;

function post(message: FromVideoWorker, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

/** Hands one decoded frame over, transferring the bitmap: after this the worker no longer holds it,
 * which is why it is taken from the cache rather than read out of it (see `takeFrame`). */
function postFrame(id: number, index: number, bitmap: ImageBitmap | null): void {
  const message: FrameMessage = { kind: "frame", id, index, bitmap };
  post(message, bitmap ? [bitmap] : []);
}

async function open(id: number, file: File, cacheSize: number): Promise<void> {
  backend?.close();
  backend = null;
  const opened = await openStreamingBlob(file, {
    cacheSize,
    // The page counts this up on the picker while somebody waits on it.
    onIndexProgress: (bytesRead) => post({ kind: "indexProgress", id, bytesRead }),
  });
  backend = opened;
  post({
    kind: "opened",
    id,
    video: {
      numFrames: opened.numFrames,
      fps: opened.fps,
      width: opened.width,
      height: opened.height,
      shape: opened.shape,
      technical: opened.technical,
    },
  });
}

/** Reads a whole read-ahead window and sends every frame of it. The window is decoded in one pass,
 * as it was before any of this crossed a thread, and then drained frame by frame: what the page
 * keeps is what it is handed, so nothing is left cached on both sides. */
async function prefetch(id: number, lo: number, hi: number, open: StreamingVideoBackend): Promise<void> {
  await open.prefetch(lo, hi);
  for (let index = lo; index <= hi; index++) {
    const bitmap = await open.takeFrame(index).catch(() => null);
    // Only what the window actually decoded: a frame it never reached is left for a request of its
    // own rather than decoded again here.
    if (bitmap) postFrame(id, index, bitmap);
  }
  post({ kind: "prefetched", id });
}

worker.onmessage = async (event: MessageEvent<ToVideoWorker>): Promise<void> => {
  const message = event.data;
  try {
    if (message.kind === "open") {
      await open(message.id, message.file, message.cacheSize);
      return;
    }
    // Everything below needs an open recording. A request arriving after one was closed is answered
    // rather than dropped, so nothing on the page is left waiting on a frame that is not coming.
    const open_ = backend;
    if (!open_) {
      if (message.kind === "frame") postFrame(message.id, message.index, null);
      else post({ kind: "failed", id: message.id, message: "The video was closed before it could answer" });
      return;
    }
    if (message.kind === "frame") {
      postFrame(message.id, message.index, await open_.takeFrame(message.index));
    } else if (message.kind === "prefetch") {
      await prefetch(message.id, message.lo, message.hi, open_);
    } else {
      const times = await open_.getFrameTimes();
      const packed = times ? Float64Array.from(times) : null;
      post({ kind: "frameTimes", id: message.id, times: packed }, packed ? [packed.buffer] : []);
    }
  } catch (e) {
    post({ kind: "failed", id: message.id, message: (e as Error).message });
  }
};
