import { afterEach, describe, expect, it, vi } from "vitest";
import { encodedFraction, ffmpegArgs, loggedDuration, transcodeArgs } from "../../src/lib/ffmpeg";

// convertToMp4 is exercised against a stubbed FFmpeg class rather than the real ffmpeg.wasm: what
// is under test is the timeout race around it, not the encode itself, and the real thing needs a
// worker and a 30MB core fetched from a CDN this suite has no business reaching. @ffmpeg/util's
// toBlobURL is stubbed for the same reason — ensureFfmpeg calls it before the class is ever used.
vi.mock("@ffmpeg/util", () => ({ toBlobURL: vi.fn(() => Promise.resolve("blob:stub")) }));

// A mutable box the mocked FFmpeg constructor reads from, so each test can hand it a fresh stub.
// ffmpeg.ts keeps its ffmpeg.wasm instance in a module-level singleton, so a test that wants its
// own — to catch a fresh `new FFmpeg()` and assert on the stub `terminate()` lands on — has to
// reset the module registry first (see loadConvertToMp4 below); the plain top-of-file import above
// is left importing the pure functions that carry no such state.
const ffmpegStub = vi.hoisted(() => ({ current: null as unknown }));
// A plain `function`, not an arrow one: `new FFmpeg()` needs something constructible, and an arrow
// function can never be (wrapping it in vi.fn() does not change that). Returning an object from a
// constructor call is what makes `new` yield that object instead of the implicit `this`.
vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: function FFmpeg() {
    return ffmpegStub.current;
  },
}));

/** A stand-in for the real FFmpeg class: enough of its surface for ensureFfmpeg and convertToMp4 to
 * run against, with `exec` behaving however a test needs it to. */
function stubFfmpeg(exec: () => Promise<number>) {
  return {
    loaded: false,
    on: vi.fn(),
    load: vi.fn(function (this: { loaded: boolean }) {
      this.loaded = true;
      return Promise.resolve(true);
    }),
    writeFile: vi.fn(() => Promise.resolve()),
    exec,
    readFile: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
    deleteFile: vi.fn(() => Promise.resolve()),
    terminate: vi.fn(function (this: { loaded: boolean }) {
      this.loaded = false;
    }),
  };
}

/** Loads a fresh instance of the module under test, so its ffmpeg.wasm singleton starts empty and
 * `new FFmpeg()` — and so the mock above — is exercised again rather than reusing another test's. */
async function loadConvertToMp4() {
  vi.resetModules();
  return (await import("../../src/lib/ffmpeg")).convertToMp4;
}

const aSource = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob;

describe("ffmpegArgs", () => {
  it("builds a frame-exact trim filter in precise mode", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise");
    expect(args).toContain("-vf");
    expect(args).toContain("trim=start_frame=10:end_frame=41,setpts=PTS-STARTPTS");
    expect(args).toContain("libx264");
    expect(args[args.length - 1]).toBe("clip.mp4");
  });

  it("builds a keyframe-aligned stream copy in fast mode", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast");
    expect(args).toEqual([
      "-ss",
      "1.0000",
      "-i",
      "in.mp4",
      "-t",
      "2.0000",
      "-c",
      "copy",
      "-an",
      "-avoid_negative_ts",
      "make_zero",
      "clip.mp4",
    ]);
  });

  it("drops audio on every route out, a stream copy included", () => {
    const blur = [{ x: 10, y: 10, radius: 20 }];
    // `-c copy` would otherwise carry the source's audio straight through, which is the one route
    // that ever did.
    expect(ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast")).toContain("-an");
    expect(ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise")).toContain("-an");
    expect(ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast", blur)).toContain("-an");
    expect(ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise", blur)).toContain("-an");
  });

  it("trims and blurs in one graph, mapping the label the blur ends on", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise", [{ x: 320, y: 240, radius: 60 }]);
    expect(args).not.toContain("-vf");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph.startsWith("[0:v]trim=start_frame=10:end_frame=41,setpts=PTS-STARTPTS,split=2")).toBe(true);
    expect(graph.endsWith("[blurout]")).toBe(true);
    expect(args[args.indexOf("-map") + 1]).toBe("[blurout]");
    expect(args).toContain("libx264");
  });

  it("re-encodes even in fast mode once anything is blurred, since a stream copy cannot burn one in", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast", [{ x: 10, y: 10, radius: 20 }]);
    expect(args).not.toContain("copy");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("libx264");
  });
});

describe("encodedFraction", () => {
  // The numbers here are what ffmpeg.wasm reported while cutting a three-second snippet out of a
  // sixty-second recording: its own `progress` never passes 0.05, since that is all of the source
  // the snippet covers.
  it("measures the clip being written rather than the source it came out of", () => {
    expect(encodedFraction({ progress: 0.0242, time: 1450000 }, 3)).toBeCloseTo(0.4833, 4);
    expect(encodedFraction({ progress: 0.0483, time: 2900065 }, 3)).toBeCloseTo(0.9667, 4);
  });

  it("has nothing to report until the first frame is muxed", () => {
    // AV_NOPTS_VALUE, which arrives while ffmpeg is still decoding its way up to the selection.
    expect(encodedFraction({ progress: 153722867280.9, time: 9223372036854776000 }, 3)).toBe(null);
    expect(encodedFraction({ progress: 0, time: Number.NaN }, 3)).toBe(null);
    expect(encodedFraction({ progress: 0, time: -1000 }, 3)).toBe(null);
  });

  it("refuses to divide by a selection with no duration", () => {
    expect(encodedFraction({ progress: 0.5, time: 1000 }, 0)).toBe(null);
    expect(encodedFraction({ progress: 0.5, time: 1000 }, Number.NaN)).toBe(null);
  });

  it("holds at full rather than overshooting it", () => {
    expect(encodedFraction({ progress: 1, time: 3100000 }, 3)).toBe(1);
  });
});

describe("transcodeArgs", () => {
  it("re-encodes the whole file into a faststart MP4 with no audio", () => {
    const args = transcodeArgs("source.avi", "converted.mp4");
    expect(args).toEqual([
      "-i",
      "source.avi",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "converted.mp4",
    ]);
  });

  it("never copies the source's frames across, since the codec is half of why it would not open", () => {
    // An AVI holding MJPEG or DivX remuxes into an MP4 that opens and then decodes nothing.
    expect(transcodeArgs("source.avi", "converted.mp4")).not.toContain("copy");
  });
});

describe("convertToMp4", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the converted MP4 and the command that produced it", async () => {
    const stub = stubFfmpeg(() => Promise.resolve(0));
    ffmpegStub.current = stub;
    const convertToMp4 = await loadConvertToMp4();

    const result = await convertToMp4(aSource, "mice.avi");
    expect(result.blob.type).toBe("video/mp4");
    expect(result.command).toBe(
      "ffmpeg -i source.avi -an -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart converted.mp4",
    );
    expect(stub.terminate).not.toHaveBeenCalled();
  });

  it("gives up on a stalled conversion, killing the worker rather than waiting on it forever", async () => {
    vi.useFakeTimers();
    // Never resolves: standing in for a codec ffmpeg.wasm decodes at a crawl, or hangs outright on.
    const stub = stubFfmpeg(() => new Promise(() => {}));
    ffmpegStub.current = stub;
    const convertToMp4 = await loadConvertToMp4();

    // The `.catch()` is attached in this same tick, before the clock ever moves: attaching it only
    // after advancing the fake timers would leave the promise briefly unhandled, since settling
    // happens somewhere inside that advance, and Node flags that gap even once it is caught here.
    const failure = convertToMp4(aSource, "mice.avi").catch((e: unknown) => e as Error);
    // Lets ensureFfmpeg's own awaits (load, writeFile) settle before the clock reaches the timer
    // convertToMp4 started around the whole race, then carries it past that timer.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    const error = await failure;
    expect(error.message).toMatch(/codec ffmpeg struggles with/);
    expect(error.message).toMatch(/2 minutes/);
    expect(stub.terminate).toHaveBeenCalledTimes(1);
  });

  it("lets a real ffmpeg error through rather than reporting it as a stall", async () => {
    const stub = stubFfmpeg(() => Promise.reject(new Error("ffmpeg exited with code 1")));
    ffmpegStub.current = stub;
    const convertToMp4 = await loadConvertToMp4();

    await expect(convertToMp4(aSource, "mice.avi")).rejects.toThrow("ffmpeg exited with code 1");
    expect(stub.terminate).not.toHaveBeenCalled();
  });
});

describe("loggedDuration", () => {
  it("reads the source duration off the line ffmpeg probes it with", () => {
    expect(loggedDuration("  Duration: 00:00:12.34, start: 0.000000, bitrate: 1200 kb/s")).toBeCloseTo(12.34, 5);
    expect(loggedDuration("  Duration: 01:02:03.00, start: 0.000000, bitrate: 900 kb/s")).toBeCloseTo(3723, 5);
  });

  it("reports nothing for a line carrying no duration, or a duration of none", () => {
    expect(loggedDuration("frame=  120 fps=0.0 q=28.0 size=     256kB")).toBeNull();
    expect(loggedDuration("  Duration: N/A, start: 0.000000, bitrate: N/A")).toBeNull();
    // A source ffmpeg cannot time is no more measurable than one it cannot read.
    expect(loggedDuration("  Duration: 00:00:00.00, start: 0.000000, bitrate: N/A")).toBeNull();
  });
});
