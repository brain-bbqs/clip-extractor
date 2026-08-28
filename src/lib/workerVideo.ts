import { FrameCache } from "./streaming";
import type { TechnicalDetail } from "./provenance";
import type { SleapVideoBackend } from "./types";
import type { FromVideoWorker, OpenedVideo, ToVideoWorker } from "./videoWorkerProtocol";

// The page's half of the worker-backed video source: the same surface the in-process backend
// presents (lib/streaming.ts), with the reading, indexing and decoding behind it happening on
// another thread. See videoWorkerProtocol.ts for why only a local file is opened this way.
//
// The decoded-frame cache lives here rather than there, which is what keeps a frame from being both
// held in the worker and transferred out of it: a bitmap crossing threads is moved, not copied, so
// the copy left behind would be a detached one nobody can draw. The worker gives every frame up as
// it produces it; this side is the only place one is kept, and a seek back to a frame already held
// never reaches the worker at all.

/** How long a request may go unanswered before it is treated as lost. Nothing here waits on a
 * network — the file is on the machine — so an answer that has not come by now is a worker that
 * died, and a promise nobody settles would hang the player rather than fail it. */
const REQUEST_TIMEOUT_MS = 120_000;

export interface WorkerVideoOptions {
  /** Decoded frames to keep on this side. */
  cacheSize?: number;
  /** Called as the container index is read, with the bytes read so far. */
  onIndexProgress?: (bytesRead: number) => void;
}

/** A request waiting on the worker. The kind is kept because the two that stream frames back are
 * told apart by it: a read-ahead's frames arrive under its own id and settle nothing. */
interface Pending {
  kind: ToVideoWorker["kind"];
  resolve: (message: FromVideoWorker) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Whether this browser can open a video off the page's thread at all. */
export function workerVideoSupported(): boolean {
  return typeof Worker === "function" && typeof createImageBitmap === "function";
}

export class WorkerVideoBackend implements SleapVideoBackend {
  readonly shape: [number, number, number, number];
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly numFrames: number;
  readonly technical: TechnicalDetail;

  private readonly cache: FrameCache<ImageBitmap>;
  private readonly pending = new Map<number, Pending>();
  /** Resolvers waiting on a frame a read-ahead is expected to bring in, keyed by frame index. */
  private readonly waiters = new Map<number, (() => void)[]>();
  /** The read-ahead in flight, so a seek landing inside one waits for its own frame rather than
   * starting a second decode of the same window. */
  private inFlight: { lo: number; hi: number; done: Promise<void> } | null = null;
  private nextId = 1;
  private closed = false;

  private constructor(
    private readonly worker: Worker,
    video: OpenedVideo,
    cacheSize: number,
    private readonly onIndexProgress?: (bytesRead: number) => void,
  ) {
    this.shape = video.shape;
    this.fps = video.fps;
    this.width = video.width;
    this.height = video.height;
    this.numFrames = video.numFrames;
    this.technical = video.technical;
    this.cache = new FrameCache<ImageBitmap>(Math.max(1, cacheSize));
  }

  /** Opens `file` on a worker of its own, resolving once its index has been read. */
  static async open(file: File, name: string, options: WorkerVideoOptions = {}): Promise<WorkerVideoBackend> {
    const cacheSize = Math.max(1, options.cacheSize ?? 32);
    const worker = new Worker(new URL("./videoWorker.ts", import.meta.url), { type: "module", name: "video-open" });
    // Built by hand rather than through `request` below, since the instance those go through is what
    // this open is about to produce.
    try {
      const video = await new Promise<OpenedVideo>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Opening ${name} timed out`)), REQUEST_TIMEOUT_MS);
        worker.onmessage = (event: MessageEvent<FromVideoWorker>) => {
          const message = event.data;
          if (message.kind === "indexProgress") {
            options.onIndexProgress?.(message.bytesRead);
            return;
          }
          clearTimeout(timer);
          if (message.kind === "opened") resolve(message.video);
          else reject(new Error(message.kind === "failed" ? message.message : `Unexpected ${message.kind} while opening`));
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          reject(new Error(event.message || "The video worker failed to start"));
        };
        const request: ToVideoWorker = { kind: "open", id: 0, file, cacheSize };
        worker.postMessage(request);
      });
      const backend = new WorkerVideoBackend(worker, video, cacheSize, options.onIndexProgress);
      backend.listen();
      return backend;
    } catch (e) {
      // Nothing was handed back, so nothing else can shut the thread down.
      worker.terminate();
      throw e;
    }
  }

  get frameCacheSize(): number {
    return this.cache.size;
  }

  async getFrame(index: number): Promise<ImageBitmap | null> {
    if (this.closed || index < 0 || index >= this.numFrames) return null;
    const cached = this.cache.get(index);
    if (cached) return cached;
    const reading = this.inFlight;
    // A read-ahead covering this frame will send it on its way past, so wait for that one frame
    // rather than asking for a decode of it alongside.
    if (reading && index >= reading.lo && index <= reading.hi) {
      await this.awaitFrame(index, reading.done);
      const arrived = this.cache.get(index);
      if (arrived) return arrived;
      // Not there: either the read-ahead passed it by, or the video was closed out from under the
      // wait. The request below settles both — a closed backend refuses it rather than asking.
    }
    const answer = await this.request({ kind: "frame", id: 0, index }).catch(() => null);
    if (!answer || answer.kind !== "frame" || !answer.bitmap) return null;
    return this.keep(answer.index, answer.bitmap);
  }

  /** Asks for frames `lo..hi` ahead of anyone wanting them. They arrive one at a time as the worker
   * decodes them, so a seek into the window is served the moment its own frame lands. */
  async prefetch(startIndex: number, endIndex: number): Promise<void> {
    if (this.closed) return;
    const lo = Math.max(0, Math.min(startIndex, endIndex));
    const hi = Math.min(this.numFrames - 1, Math.max(startIndex, endIndex));
    if (lo > hi) return;
    let missing = false;
    for (let i = lo; i <= hi && !missing; i++) missing = !this.cache.has(i);
    if (!missing) return;
    const reading = { lo, hi, done: this.request({ kind: "prefetch", id: 0, lo, hi }).then(() => undefined) };
    this.inFlight = reading;
    try {
      await reading.done;
    } catch {
      // A read-ahead is a convenience; the frames it missed are asked for again when wanted.
    } finally {
      if (this.inFlight === reading) this.inFlight = null;
    }
  }

  /** The first key frame at or after `index` — see `StreamingVideoBackend.nextKeyFrameIndex`. Null
   * where there is none, or where nothing answered. */
  async nextKeyFrameIndex(index: number): Promise<number | null> {
    if (this.closed) return null;
    const answer = await this.request({ kind: "keyFrame", id: 0, index }).catch(() => null);
    return answer?.kind === "keyFrame" ? answer.index : null;
  }

  async getFrameTimes(): Promise<number[] | null> {
    if (this.closed) return null;
    const answer = await this.request({ kind: "frameTimes", id: 0 }).catch(() => null);
    if (!answer || answer.kind !== "frameTimes" || !answer.times) return null;
    return Array.from(answer.times);
  }

  /** Drops every decoded frame and shuts the thread down. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    for (const list of this.waiters.values()) for (const resolve of list) resolve();
    this.waiters.clear();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The video was closed"));
    }
    this.pending.clear();
    // Terminated rather than asked to close: the thread exists for this one recording, and stopping
    // it is what releases the container, the decoder and the bytes they were reading through.
    this.worker.terminate();
  }

  /** Takes over the worker's messages once it is open: answers to requests, and the frames a
   * read-ahead sends unasked. */
  private listen(): void {
    this.worker.onmessage = (event: MessageEvent<FromVideoWorker>) => {
      const message = event.data;
      if (message.kind === "indexProgress") {
        this.onIndexProgress?.(message.bytesRead);
        return;
      }
      const pending = this.pending.get(message.id);
      // A frame arriving under a read-ahead's id is one of the many it sends on its way through the
      // window; only the "prefetched" that follows them all settles it.
      if (message.kind === "frame" && pending?.kind === "prefetch") {
        if (message.bitmap) this.keep(message.index, message.bitmap);
        return;
      }
      // Anything else with nothing waiting on it is an answer to a request already given up on.
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.kind === "failed") pending.reject(new Error(message.message));
      else pending.resolve(message);
    };
    this.worker.onerror = (event) => {
      const failure = new Error(event.message || "The video worker stopped");
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(failure);
      }
    };
  }

  /** Sends one request and settles when its answer comes back. */
  private request(message: ToVideoWorker): Promise<FromVideoWorker> {
    if (this.closed) return Promise.reject(new Error("The video was closed"));
    const id = this.nextId++;
    return new Promise<FromVideoWorker>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The video worker stopped answering"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { kind: message.kind, resolve, reject, timer });
      this.worker.postMessage({ ...message, id });
    });
  }

  /** Keeps a frame that has been handed over, releasing anyone waiting on that one. */
  private keep(index: number, bitmap: ImageBitmap): ImageBitmap {
    if (this.closed) {
      bitmap.close();
      return bitmap;
    }
    this.cache.set(index, bitmap);
    const waiting = this.waiters.get(index);
    if (waiting) {
      this.waiters.delete(index);
      for (const resolve of waiting) resolve();
    }
    // set() keeps whichever bitmap was already there, so read back rather than assume.
    return this.cache.get(index) ?? bitmap;
  }

  /** Settles once `index` is cached or `until` does, whichever comes first. */
  private awaitFrame(index: number, until: Promise<void>): Promise<void> {
    let resolve!: () => void;
    const arrival = new Promise<void>((r) => {
      resolve = r;
    });
    const list = this.waiters.get(index);
    if (list) list.push(resolve);
    else this.waiters.set(index, [resolve]);
    return Promise.race([arrival, until]).then(
      () => this.dropWaiter(index, resolve),
      () => this.dropWaiter(index, resolve),
    );
  }

  private dropWaiter(index: number, resolve: () => void): void {
    const list = this.waiters.get(index);
    if (!list) return;
    const at = list.indexOf(resolve);
    if (at >= 0) list.splice(at, 1);
    if (!list.length) this.waiters.delete(index);
  }
}

/** Opens bytes already on the machine on a thread of their own. */
export function openWorkerBlob(file: File, name: string, options?: WorkerVideoOptions): Promise<WorkerVideoBackend> {
  return WorkerVideoBackend.open(file, name, options);
}
