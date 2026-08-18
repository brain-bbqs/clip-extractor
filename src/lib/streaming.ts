import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  UrlSource,
  VideoSampleSink,
} from "mediabunny";
import type { InputVideoTrack, Source, VideoSample } from "mediabunny";
import { bytes } from "./format";
import type { SleapVideoBackend } from "./types";

// A frame-indexed video backend built straight on mediabunny, used in place of sleap-io.js's
// MediaBunnyVideoBackend.
//
// The app addresses video by frame number, so opening a file means learning how many frames it has
// and where each one sits in time. sleap-io.js's backend answers that by walking every packet in
// the container and keeping its timestamp, at settings that load each packet's *data* along with
// its metadata — over a URL, the whole file before the first frame appears.
//
// Walking the packets at all is the deeper problem. A 16-hour recording holds 1.76 million of them,
// and nothing in that walk waits on the network once the container index is in memory, so it runs
// as one uninterrupted flood: minutes during which the tab cannot paint, scroll or open a console,
// and tens of megabytes of timestamps at the end of it. Almost every recording runs at a constant
// frame rate, and a container records that rate and its duration in its header, which together say
// exactly the same thing as the walk: frame `i` is at `first + i / fps`. So that is what is read,
// and it is checked against frames spread through the file before it is trusted. Only a file the
// check refuses is enumerated, and that walk now yields to the event loop as it goes.

/** The fewest decoded frames a backend keeps, whatever the video's frame rate and picture size turn
 * out to be. Each is an ImageBitmap costing width*height*4 bytes of (non-JS-heap) memory, so the
 * floor is small on purpose — it exists to keep the read-ahead window below always fully cached, not
 * to size the cache for playback. */
const DEFAULT_CACHE_SIZE = 32;

/** How long a played-back loop is expected to run before it wraps back to its start. Sized so the
 * cache below can hold a whole loop: without that, the wrap seeks back to a frame long since evicted
 * and playback stutters there every time round, on every loop rather than only the first. */
const LOOP_SECONDS = 20;

/** Ceiling on what the frame cache may cost in memory, in bytes. {@link LOOP_SECONDS} alone would
 * size the cache in proportion to frame rate and picture size with nothing to stop either from
 * making it large, so this keeps the cache "relatively small" — a fraction of a recording's frames,
 * never the whole of a big enough one — regardless of what the video turns out to be. */
const MAX_CACHE_BYTES = 512 * 1024 * 1024;

/** How many frames of `width x height` fit under {@link MAX_CACHE_BYTES}. Shared by
 * {@link defaultCacheSize} and {@link StreamingVideoBackend.ensureCacheCapacity}, so a cache grown
 * for a particular loop is held to the same ceiling the default was sized against. */
function affordableFrames(width: number, height: number): number {
  const bytesPerFrame = Math.max(1, width * height * 4);
  return Math.floor(MAX_CACHE_BYTES / bytesPerFrame);
}

/** How many decoded frames to keep by default: enough for a {@link LOOP_SECONDS} playback loop to
 * play without a re-decode at the wrap, held to {@link MAX_CACHE_BYTES} and never under
 * {@link DEFAULT_CACHE_SIZE}. A caller who knows better can still say so directly via
 * {@link StreamingBackendOptions.cacheSize}. */
export function defaultCacheSize(fps: number, width: number, height: number): number {
  const wanted = Math.ceil(fps * LOOP_SECONDS);
  return Math.max(DEFAULT_CACHE_SIZE, Math.min(wanted, affordableFrames(width, height)));
}

/** Packets the frame rate is measured over. The rate is a property of the container, not of the
 * sample, so this only has to be long enough to span a group of pictures. */
const RATE_PROBE_PACKETS = 600;

/** Where through the file the constant-rate model is checked. A rate read from a header is a claim
 * about the whole recording, and a file that drops or repeats frames somewhere in the middle would
 * put every frame index after that point on the wrong picture. */
const PROBE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

/** How far the frame count derived from the duration may sit from a whole number of frames before
 * the rate is judged not to describe the file. */
const COUNT_TOLERANCE = 0.5;

/** Packets enumerated between yields back to the event loop. Large enough that the yields cost
 * nothing on a normal clip, small enough that a long one stays interactive while it is read. */
const YIELD_EVERY = 20_000;

export interface StreamingBackendOptions {
  /** Decoded frames to keep. Defaults to {@link defaultCacheSize}, sized off the video's own frame
   * rate and picture size once they are known. */
  cacheSize?: number;
  /** Called as the container index is read, with the bytes read from the source so far. Opening a
   * large file is not instant even when it streams, and this is what a caller can say so with. */
  onIndexProgress?: (bytesRead: number) => void;
  /**
   * The most of the source that may be read to work out where its frames are. Unlimited by
   * default, which is right for bytes already on the machine and wrong for a URL.
   *
   * Everything below rests on the container recording its own duration and rate. A file that does
   * not — a recording stopped without being finalized, most of all — leaves only one way to find
   * out where its frames are, which is to read them, and a Matroska file with no cue points makes
   * even the checks against that model walk the clusters one by one from wherever the last one
   * left off. Over a URL that is the whole recording pulled through the network in range requests:
   * hours of a progress count going up, no frame ever drawn, and no error to say why.
   *
   * This settles both halves of that. A source larger than this has to be describable from its
   * header, and one that turns out not to be is refused there and then — before a packet is
   * walked, on the strength of what the header already said, which is the same answer an `.avi`
   * gets and just as cheaply. The figure is also a ceiling on what indexing may read, for the
   * container that describes itself and then makes the checking of it a walk.
   */
  maxIndexBytes?: number;
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

  constructor(private limit: number) {}

  get size(): number {
    return this.entries.size;
  }

  get capacity(): number {
    return this.limit;
  }

  /** Grows or shrinks how many frames the cache may hold. Growing never evicts — it only changes
   * how much room later insertions have before eviction starts; shrinking evicts from the front,
   * same as a normal `set()` over the new limit would. */
  setCapacity(limit: number): void {
    this.limit = Math.max(1, limit);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.get(oldest.value)?.close();
      this.entries.delete(oldest.value);
    }
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

/** What the backend knows about a track's frames: how many there are, and where each one sits in
 * time. Either derived from the container's recorded rate or enumerated packet by packet. */
export interface FrameIndex {
  readonly count: number;
  readonly fps: number;
  /** The presentation timestamp of a frame. */
  time(index: number): number;
  /** The timestamp window covering frames `lo..hi`, as mediabunny's sample iterators take it: the
   * end is exclusive, so it runs half a frame past the last one. */
  window(lo: number, hi: number): { start: number; end: number };
  /** The frame within `lo..hi` a decoded sample belongs to, or null when none of them does. */
  indexAt(timestamp: number, lo: number, hi: number): number | null;
  /** Every frame's timestamp in the order they are indexed, or null when the rate describes them.
   * A caller uses this to tell decode order from display order; null means the two agree. */
  times(): number[] | null;
}

/** The frame rate implied by `count` frames spread over `span` seconds, or null when there is not
 * enough of either to tell. `count - 1` because the span is measured between the first and last
 * frame, which is one interval short of the frame count. */
export function fpsFromSpan(count: number, span: number): number | null {
  if (count < 2 || !(span > 0) || !Number.isFinite(span)) return null;
  return (count - 1) / span;
}

/** Frames at a fixed interval: frame `i` is at `first + i / fps`, and no list of them is kept. */
export function constantRateIndex(first: number, fps: number, count: number): FrameIndex {
  const time = (index: number): number => first + index / fps;
  return {
    count,
    fps,
    time,
    window: (lo, hi) => ({ start: time(lo), end: time(hi) + 1 / (2 * fps) }),
    indexAt: (timestamp, lo, hi) => {
      const index = Math.round((timestamp - first) * fps);
      return index >= lo && index <= hi ? index : null;
    },
    // Frames are indexed in presentation order here, so decode order has nothing left to say.
    times: () => null,
  };
}

/** Frames listed one by one, in the decode order the container stores them in. The fallback for a
 * file whose rate does not describe it: variable frame rate, or frames dropped mid-recording. */
export function enumeratedIndex(times: number[]): FrameIndex {
  let first = Infinity;
  let last = -Infinity;
  for (const t of times) {
    if (t < first) first = t;
    if (t > last) last = t;
  }
  const fps = fpsFromSpan(times.length, last - first) ?? 0;
  // Only used to end a window past its last frame; a file with no measurable rate gets an epsilon.
  const nudge = fps > 0 ? 1 / (2 * fps) : 1e-6;
  return {
    count: times.length,
    fps,
    time: (index) => times[index],
    window: (lo, hi) => {
      let start = Infinity;
      let end = -Infinity;
      // Decode order and display order differ on a file with B-frames, so the window is bounded by
      // the smallest and largest timestamp across the range rather than by its endpoints.
      for (let i = lo; i <= hi; i++) {
        if (times[i] < start) start = times[i];
        if (times[i] > end) end = times[i];
      }
      return { start, end: end + nudge };
    },
    indexAt: (timestamp, lo, hi) => {
      for (let i = lo; i <= hi; i++) {
        if (times[i] === timestamp) return i;
      }
      // Decoders are entitled to hand back a timestamp that does not match the container's to the
      // last decimal, and a frame put under the wrong index is worse than one not cached at all.
      return nearestIndex(times, lo, hi, timestamp);
    },
    times: () => [...times],
  };
}

/** The frame in `times[lo..hi]` whose timestamp is nearest `timestamp`, or null when the range is
 * empty. */
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

/** Hands the event loop a turn. Used to break up work that never awaits anything else. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Checks a constant-rate model against frames spread through the file, including one frame past
 * its end, which has to land back on the last frame or the count is wrong. */
export async function modelHolds(
  packetAt: (timestamp: number) => Promise<{ timestamp: number } | null>,
  index: FrameIndex,
): Promise<boolean> {
  const tolerance = 1 / (2 * index.fps);
  for (const fraction of PROBE_FRACTIONS) {
    const frame = Math.round((index.count - 1) * fraction);
    const want = index.time(frame);
    const packet = await packetAt(want);
    if (!packet || Math.abs(packet.timestamp - want) > tolerance) return false;
  }
  const past = await packetAt(index.time(index.count));
  return !!past && Math.abs(past.timestamp - index.time(index.count - 1)) <= tolerance;
}

/** Throws once opening has read more of the source than it is allowed to. Called wherever a read
 * that should have been a seek could be walking the file instead. */
type ReadBudget = () => void;

/** The constant-rate model for a track, or null when the container does not describe one or the
 * file does not hold to it. */
async function constantRateFor(track: InputVideoTrack, packets: EncodedPacketSink, budget: ReadBudget): Promise<FrameIndex | null> {
  const duration = await track.getDurationFromMetadata();
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return null;
  const { averagePacketRate: fps } = await track.computePacketStats(RATE_PROBE_PACKETS);
  if (!Number.isFinite(fps) || fps <= 0) return null;
  const firstPacket = await packets.getFirstPacket({ metadataOnly: true });
  if (!firstPacket) return null;
  const span = duration - firstPacket.timestamp;
  const count = Math.round(span * fps);
  // The rate has to account for the whole span, not just the prefix it was measured over.
  if (count < 1 || Math.abs(span * fps - count) > COUNT_TOLERANCE) return null;
  const index = constantRateIndex(firstPacket.timestamp, fps, count);
  // Each probe is a seek only where the container carries something to seek by. Where it does not,
  // it is a walk from wherever the last one ended, and five of them across the file are the file.
  const holds = await modelHolds(async (timestamp) => {
    const packet = await packets.getPacket(timestamp, { metadataOnly: true });
    budget();
    return packet;
  }, index);
  return holds ? index : null;
}

/** Every packet's timestamp, in decode order, yielding to the event loop as it goes. */
async function enumerateFrameTimes(packets: EncodedPacketSink, budget: ReadBudget): Promise<number[]> {
  const times: number[] = [];
  for await (const packet of packets.packets(undefined, undefined, { metadataOnly: true })) {
    times.push(packet.timestamp);
    // Checked every packet rather than at the yields below: over a URL each one of these can be
    // another range request, and a budget only looked at every twenty thousand of them is twenty
    // thousand requests coarse.
    budget();
    // Nothing in this loop waits on the network once the container index is in memory, so without
    // a yield it drains as one uninterrupted flood and the tab goes unresponsive until it ends.
    if (times.length % YIELD_EVERY === 0) await yieldToEventLoop();
  }
  return times;
}

export interface RangeExtractOptions {
  /** Frame-exact: the cut starts on `lo` itself, re-encoding from the key frame before it when it
   * has to. Otherwise it starts at that key frame, which copies the frames over untouched but may
   * carry a few leading ones. */
  precise: boolean;
  /** Draws into each frame on its way out. Anything drawn forces a re-encode. */
  process?: (sample: VideoSample) => VideoSample;
  /** 0..1 through the selection. */
  onProgress?: (fraction: number) => void;
}

export interface ExtractedRange {
  blob: Blob;
  /** Whether the frames were re-encoded rather than copied over untouched. */
  transcoded: boolean;
  /** The timestamps the cut actually spans. `start` is rounded back to a key frame when the cut is
   * not frame-exact, so it is not always the selection's first frame. */
  start: number;
  end: number;
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
    private readonly track: InputVideoTrack,
    private readonly index: FrameIndex,
    cacheSize: number,
  ) {
    this.sink = new VideoSampleSink(track);
    this.cache = new FrameCache<ImageBitmap>(Math.max(1, cacheSize));
    this.width = track.displayWidth;
    this.height = track.displayHeight;
    this.fps = index.fps;
    this.shape = [index.count, this.height, this.width, 3];
  }

  get numFrames(): number {
    return this.index.count;
  }

  /** Opens `source`, reading only as much of it as the container index takes. */
  static async open(source: Source, options: StreamingBackendOptions = {}): Promise<StreamingVideoBackend> {
    const input = new Input({ source, formats: ALL_FORMATS });
    let read = 0;
    // Watched whether or not anyone asked for progress: the count is also what the budget below is
    // measured against.
    const stopWatching = source.on("read", ({ start, end }) => {
      read += end - start;
      options.onIndexProgress?.(read);
    });
    const allowed = options.maxIndexBytes ?? Infinity;
    const budget: ReadBudget = () => {
      if (read <= allowed) return;
      throw new Error(
        `where its frames are is not recorded in the container, and reading the file itself to find out passed ${bytes(allowed)}`,
      );
    };
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("No video track found in file");
      // Asked before any frame is wanted, so an unsupported codec falls to another backend at open
      // time rather than as a blank player.
      if (!(await track.canDecode())) throw new Error(`Cannot decode video codec ${track.codec ?? "unknown"}`);
      const packets = new EncodedPacketSink(track);
      const constant = await constantRateFor(track, packets, budget);
      // Nothing in the container says where the frames are, so the only way left to find out is to
      // read them — all of them, in order, before the first one can be drawn. For a file past the
      // budget that is not a slow open but an open that does not finish, so it is refused here,
      // where the only thing read so far is the header. Checked against the budget too, since the
      // walk that established there was no model may already have been the expensive part.
      if (!constant) {
        budget();
        const size = await source.getSizeOrNull().catch(() => null);
        if (size !== null && size > allowed) {
          throw new Error(
            `where its frames are is not recorded in the container, and finding out would mean reading all ${bytes(size)} of it`,
          );
        }
      }
      const index = constant ?? enumeratedIndex(await enumerateFrameTimes(packets, budget));
      if (!index.count) throw new Error("No frames found in video track");
      const cacheSize = options.cacheSize ?? defaultCacheSize(index.fps, track.displayWidth, track.displayHeight);
      return new StreamingVideoBackend(input, track, index, cacheSize);
    } catch (e) {
      // Nothing was handed back, so nothing else can dispose the input or the requests behind it.
      input.dispose();
      throw e;
    } finally {
      stopWatching();
    }
  }

  /** Frame timestamps in the order they are indexed, or null when the rate describes them and
   * decode order is already display order. */
  getFrameTimes(): Promise<number[] | null> {
    return Promise.resolve(this.index.times());
  }

  async getFrame(index: number): Promise<ImageBitmap | null> {
    if (this.closed || index < 0 || index >= this.index.count) return null;
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

  /** Grows the frame cache to hold at least `frames` decoded frames at once, held to the same
   * {@link MAX_CACHE_BYTES} ceiling {@link defaultCacheSize} sizes the default cache against. Never
   * shrinks it: a caller sizing the cache for one loop should not undo a larger one asked for
   * earlier. Meant to run once, just ahead of a {@link prefetch} of the same range — otherwise a
   * loop longer than the default cache would decode its whole self and still evict the frames at its
   * own start before the first playback pass even reaches its end. */
  ensureCacheCapacity(frames: number): void {
    const size = Math.max(DEFAULT_CACHE_SIZE, Math.min(frames, affordableFrames(this.width, this.height)));
    if (size > this.cache.capacity) this.cache.setCapacity(size);
  }

  /** Decodes `startIndex..endIndex` into the cache, ahead of anyone asking for them. */
  async prefetch(startIndex: number, endIndex: number): Promise<void> {
    if (this.closed) return;
    const lo = Math.max(0, Math.min(startIndex, endIndex));
    const hi = Math.min(this.index.count - 1, Math.max(startIndex, endIndex));
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

  /** Trims frames `lo..hi` into an MP4, reading only the bytes that range needs.
   *
   * This is what a streamed source is extracted with instead of ffmpeg.wasm, which needs the whole
   * container in its virtual filesystem: for a remote recording that means downloading all of it —
   * hours for a large one, and more than a 32-bit address space can hold besides, however small the
   * selection is. Here the same range requests that play the video also cut it. */
  async extractRange(lo: number, hi: number, options: RangeExtractOptions): Promise<ExtractedRange> {
    if (this.closed) throw new Error("The video was closed before the selection could be extracted");
    const first = Math.max(0, Math.min(lo, hi));
    const last = Math.min(this.index.count - 1, Math.max(lo, hi));
    if (first > last) throw new Error("There is nothing selected to extract");
    // Frames can only be copied over untouched from a point the decoder can start at; anything else
    // — a frame-exact cut, or a blur to draw in — has to be re-encoded.
    const transcoded = options.precise || !!options.process;
    const wanted = this.index.time(first);
    const keyPacket = transcoded ? null : await new EncodedPacketSink(this.track).getKeyPacket(wanted, { metadataOnly: true });
    const start = keyPacket?.timestamp ?? wanted;
    const end = this.index.window(last, last).end;

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input: this.input,
      output,
      // The player is video-only, and a recording this app exists to de-identify should not carry
      // voices out of it in a track nobody was shown. The frame-exact cut has always dropped audio;
      // this drops it whichever way the cut is made.
      audio: { discard: true },
      video: { forceTranscode: transcoded, process: options.process },
      trim: { start, end },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const reasons = [...new Set(conversion.discardedTracks.map((track) => track.reason))].join(", ");
      throw new Error(`This video cannot be trimmed in the browser (${reasons || "unsupported source"})`);
    }
    const report = options.onProgress;
    if (report) conversion.onProgress = (fraction) => report(fraction);
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer?.byteLength) throw new Error("Trimming produced an empty clip — try a different selection");
    return { blob: new Blob([buffer], { type: "video/mp4" }), transcoded, start, end };
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
    const sample = await this.sink.getSample(this.index.time(index));
    if (!sample) return null;
    try {
      return this.keep(index, sample);
    } finally {
      sample.close();
    }
  }

  private async decodeRange(lo: number, hi: number): Promise<void> {
    const window = this.index.window(lo, hi);
    if (!Number.isFinite(window.start) || !Number.isFinite(window.end)) return;
    for await (const sample of this.sink.samples(window.start, window.end)) {
      try {
        if (this.closed) return;
        const index = this.index.indexAt(sample.timestamp, lo, hi);
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
