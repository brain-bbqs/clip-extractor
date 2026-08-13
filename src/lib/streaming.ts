import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, UrlSource, VideoSampleSink } from "mediabunny";
import type { InputVideoTrack, Source } from "mediabunny";
import type { SleapVideoBackend } from "./types";

// A frame-indexed video backend built straight on mediabunny, used in place of sleap-io.js's
// MediaBunnyVideoBackend.
//
// Both open a file the same way — read the container index, list every packet's timestamp, then
// decode single frames or short runs on demand — but sleap-io.js builds that timestamp list with
// `EncodedPacketSink.packets()` at its default settings, which loads each packet's *data* as well as
// its metadata. Over a URL that is the whole file: opening a 10.6 GB recording pulled all 10.6 GB
// down before the first frame appeared, which is the "it downloads instead of streaming" this
// replaces. Asking for `metadataOnly` reads the same timestamps out of the container index that
// opening the track already parsed, so the same file opens after ~71 MB of index and every later
// byte is a frame somebody actually looked at.

/** How many decoded frames a backend keeps. Each is an ImageBitmap costing width*height*4 bytes of
 * (non-JS-heap) memory, so the number is small on purpose — see FRAME_CACHE_SIZE in main.ts. */
const DEFAULT_CACHE_SIZE = 32;

export interface StreamingBackendOptions {
  /** Decoded frames to keep. Defaults to {@link DEFAULT_CACHE_SIZE}. */
  cacheSize?: number;
  /** Called as the container index is read, with the bytes read from the source so far. Opening a
   * large file is not instant even when it streams, and this is what a caller can say so with. */
  onIndexProgress?: (bytesRead: number) => void;
}

/** Anything closable enough to be cached as a decoded frame. Written as an interface rather than
 * `ImageBitmap` so the cache can be exercised without one. */
interface Closable {
  close(): void;
}

/** The decoded-frame cache: a fixed-size LRU that closes what it evicts, since an ImageBitmap holds
 * memory the garbage collector does not account for and will not free on its own. */
export class FrameCache<T extends Closable> {
  private readonly entries = new Map<number, T>();

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.entries.size;
  }

  has(index: number): boolean {
    return this.entries.has(index);
  }

  /** The frame at `index`, if it is still held, counting the lookup as a use. */
  get(index: number): T | null {
    const frame = this.entries.get(index);
    if (!frame) return null;
    // Re-inserting moves it to the end of the Map's iteration order, which is where "most recently
    // used" lives: eviction takes from the front.
    this.entries.delete(index);
    this.entries.set(index, frame);
    return frame;
  }

  /** Keeps `frame`, evicting the least recently used one if that puts the cache over its limit. A
   * frame already held at `index` is left alone and the new one closed, so a duplicate decode can
   * never invalidate a bitmap a caller is holding. */
  set(index: number, frame: T): void {
    const existing = this.entries.get(index);
    if (existing) {
      if (existing !== frame) frame.close();
      return;
    }
    while (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.get(oldest.value)?.close();
      this.entries.delete(oldest.value);
    }
    this.entries.set(index, frame);
  }

  /** Closes and drops everything held. */
  clear(): void {
    for (const frame of this.entries.values()) frame.close();
    this.entries.clear();
  }
}

/** The frame rate implied by `count` frames spread over `span` seconds, or null when there is not
 * enough of either to tell. `count - 1` because the span is measured between the first and last
 * frame, which is one interval short of the frame count. */
export function fpsFromSpan(count: number, span: number): number | null {
  if (count < 2 || !(span > 0) || !Number.isFinite(span)) return null;
  return (count - 1) / span;
}

/** The timestamp range covering frames `startIndex..endIndex` of `times`, as the half-open window
 * mediabunny's sample iterators take: `end` is exclusive, so it is nudged past the last frame by
 * half a frame, which would otherwise be decoded and dropped.
 *
 * `times` is in decode order and a file with B-frames has that differ from display order, so the
 * bounds are the smallest and largest timestamp across the range rather than its endpoints. */
export function decodeWindow(
  times: number[],
  startIndex: number,
  endIndex: number,
  frameDuration: number,
): { start: number; end: number } | null {
  const lo = Math.max(0, Math.min(startIndex, endIndex));
  const hi = Math.min(times.length - 1, Math.max(startIndex, endIndex));
  if (lo > hi || hi < 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const t = times[i];
    if (t < start) start = t;
    if (t > end) end = t;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const nudge = Number.isFinite(frameDuration) && frameDuration > 0 ? frameDuration / 2 : 1e-6;
  return { start, end: end + nudge };
}

/** The frame in `times[lo..hi]` whose timestamp is nearest `timestamp`, or null when the range is
 * empty. Decoders are entitled to hand back a timestamp that does not match the container's to the
 * last decimal, and a frame put under the wrong index is worse than one not cached at all. */
export function nearestIndex(times: number[], lo: number, hi: number, timestamp: number): number | null {
  let best: number | null = null;
  let bestDiff = Infinity;
  for (let i = lo; i <= hi; i++) {
    const diff = Math.abs(times[i] - timestamp);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** A range decode in flight, so a seek landing inside one can wait for its own frame instead of
 * starting a second decoder over the same packets. */
interface PendingRange {
  lo: number;
  hi: number;
  done: Promise<void>;
}

export class StreamingVideoBackend implements SleapVideoBackend {
  readonly shape: [number, number, number, number];
  readonly fps: number;
  readonly width: number;
  readonly height: number;

  private readonly cache: FrameCache<ImageBitmap>;
  private readonly sink: VideoSampleSink;
  /** Resolvers waiting on a specific frame to land in the cache, keyed by frame index. */
  private readonly waiters = new Map<number, (() => void)[]>();
  private pending: PendingRange | null = null;
  private closed = false;

  private constructor(
    private readonly input: Input,
    track: InputVideoTrack,
    /** Packet timestamps in decode order, one per frame. Indices throughout are into this. */
    private readonly frameTimes: number[],
    span: number,
    cacheSize: number,
  ) {
    this.sink = new VideoSampleSink(track);
    this.cache = new FrameCache<ImageBitmap>(Math.max(1, cacheSize));
    this.width = track.displayWidth;
    this.height = track.displayHeight;
    this.fps = fpsFromSpan(frameTimes.length, span) ?? 0;
    this.shape = [frameTimes.length, this.height, this.width, 3];
  }

  get numFrames(): number {
    return this.frameTimes.length;
  }

  /** Opens `source`, reading only as much of it as the container index takes. */
  static async open(source: Source, options: StreamingBackendOptions = {}): Promise<StreamingVideoBackend> {
    const input = new Input({ source, formats: ALL_FORMATS });
    let read = 0;
    const stopWatching = options.onIndexProgress
      ? source.on("read", ({ start, end }) => {
          read += end - start;
          options.onIndexProgress?.(read);
        })
      : null;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("No video track found in file");
      // Asked before any frame is wanted, so an unsupported codec falls to another backend at open
      // time rather than as a blank player.
      if (!(await track.canDecode())) throw new Error(`Cannot decode video codec ${track.codec ?? "unknown"}`);
      const frameTimes: number[] = [];
      let first = Infinity;
      let last = -Infinity;
      // metadataOnly is the whole point: see the note at the top of this file.
      for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
        frameTimes.push(packet.timestamp);
        if (packet.timestamp < first) first = packet.timestamp;
        if (packet.timestamp > last) last = packet.timestamp;
      }
      if (!frameTimes.length) throw new Error("No frames found in video track");
      return new StreamingVideoBackend(input, track, frameTimes, last - first, options.cacheSize ?? DEFAULT_CACHE_SIZE);
    } catch (e) {
      // Nothing was handed back, so nothing else can dispose the input or the requests behind it.
      input.dispose();
      throw e;
    } finally {
      stopWatching?.();
    }
  }

  /** A copy, so a caller sorting or trimming it cannot disturb the index every frame lookup uses. */
  getFrameTimes(): Promise<number[]> {
    return Promise.resolve([...this.frameTimes]);
  }

  async getFrame(index: number): Promise<ImageBitmap | null> {
    if (this.closed || index < 0 || index >= this.frameTimes.length) return null;
    const cached = this.cache.get(index);
    if (cached) return cached;
    const pending = this.pending;
    // A read-ahead covering this frame will decode it on its way past. Waiting for that one frame —
    // rather than for the whole range, which is what sleap-io.js's backend makes a caller do —
    // keeps a seek into a window that is already being decoded as quick as the frame itself.
    if (pending && index >= pending.lo && index <= pending.hi) {
      await this.awaitFrame(index, pending.done);
      const arrived = this.cache.get(index);
      if (arrived) return arrived;
    }
    return this.decodeOne(index);
  }

  /** Decodes `startIndex..endIndex` into the cache, ahead of anyone asking for them. */
  async prefetch(startIndex: number, endIndex: number): Promise<void> {
    if (this.closed) return;
    const lo = Math.max(0, Math.min(startIndex, endIndex));
    const hi = Math.min(this.frameTimes.length - 1, Math.max(startIndex, endIndex));
    if (lo > hi) return;
    // Everything already in hand: the decode would evict frames to re-cache frames.
    let missing = false;
    for (let i = lo; i <= hi && !missing; i++) missing = !this.cache.has(i);
    if (!missing) return;
    const range = { lo, hi, done: this.decodeRange(lo, hi) };
    this.pending = range;
    try {
      await range.done;
    } finally {
      // Only if it is still this one: a later window may have replaced it while this was decoding.
      if (this.pending === range) this.pending = null;
    }
  }

  /** Drops every decoded frame and cancels whatever the source still has in flight. */
  close(): void {
    this.closed = true;
    this.cache.clear();
    // Anything waiting on a frame that will now never be decoded is released to fall through to its
    // own closed-backend check, rather than left holding a promise nobody will settle.
    for (const list of this.waiters.values()) for (const resolve of list) resolve();
    this.waiters.clear();
    this.input.dispose();
  }

  private async decodeOne(index: number): Promise<ImageBitmap | null> {
    // Reached either directly or after waiting on a read-ahead, which is long enough for the video
    // to have been closed out from under it.
    if (this.closed) return null;
    const sample = await this.sink.getSample(this.frameTimes[index]);
    if (!sample) return null;
    try {
      return this.keep(index, sample);
    } finally {
      sample.close();
    }
  }

  private async decodeRange(lo: number, hi: number): Promise<void> {
    const window = decodeWindow(this.frameTimes, lo, hi, this.fps > 0 ? 1 / this.fps : 0);
    if (!window) return;
    // Only the requested range's timestamps, so a sample landing outside it is matched to the frame
    // it belongs to rather than to the nearest one anybody asked for.
    for await (const sample of this.sink.samples(window.start, window.end)) {
      try {
        if (this.closed) return;
        const index = this.frameIndexAt(sample.timestamp, lo, hi);
        if (index === null || this.cache.has(index)) continue;
        await this.keep(index, sample);
      } finally {
        sample.close();
      }
    }
  }

  /** Turns a decoded sample into a cached bitmap, releasing anyone waiting on that frame. */
  private async keep(index: number, sample: { toVideoFrame(): VideoFrame }): Promise<ImageBitmap> {
    const frame = sample.toVideoFrame();
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(frame);
    } finally {
      frame.close();
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

  /** The frame index `timestamp` belongs to: the exact match the container recorded, or the nearest
   * frame in `lo..hi` when the decoder's timestamp differs in the last decimals. */
  private frameIndexAt(timestamp: number, lo: number, hi: number): number | null {
    for (let i = lo; i <= hi; i++) {
      if (this.frameTimes[i] === timestamp) return i;
    }
    return nearestIndex(this.frameTimes, lo, hi, timestamp);
  }

  /** Settles once `index` is cached or `until` does, whichever comes first, leaving no waiter
   * behind either way. */
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

/** Opens a video streamed from `url` over range requests. */
export function openStreamingUrl(url: string, options?: StreamingBackendOptions): Promise<StreamingVideoBackend> {
  return StreamingVideoBackend.open(new UrlSource(url), options);
}

/** Opens a video from bytes already in hand, read the same lazily. */
export function openStreamingBlob(blob: Blob, options?: StreamingBackendOptions): Promise<StreamingVideoBackend> {
  return StreamingVideoBackend.open(new BlobSource(blob), options);
}
