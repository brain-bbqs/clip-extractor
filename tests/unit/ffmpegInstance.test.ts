// The shared ffmpeg.wasm instance's lifecycle — lazy load, handler re-wiring, interruption teardown
// — against a stand-in for @ffmpeg/ffmpeg. Kept apart from ffmpeg.test.ts, which covers the pure
// command-building half of the module against the real thing.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureFfmpeg, runFfmpeg, terminateFfmpeg } from "../../src/lib/ffmpeg";
import { InterruptedError } from "../../src/lib/interrupt";

// Hoisted so the class exists by the time the mock factory below runs, which is before this file's
// own top-level statements.
const { FakeFFmpeg, harness } = vi.hoisted(() => {
  const harness = {
    instances: [] as InstanceType<typeof FakeFFmpeg>[],
    blobbed: [] as [string, string][],
  };
  class FakeFFmpeg {
    loaded = false;
    listeners = new Map<string, (event: never) => void>();
    loadedWith: unknown = null;
    exec = vi.fn(() => Promise.resolve(0));
    terminate = vi.fn();
    constructor() {
      harness.instances.push(this);
    }
    on(event: string, listener: (event: never) => void): void {
      this.listeners.set(event, listener);
    }
    load(options: unknown): Promise<boolean> {
      this.loaded = true;
      this.loadedWith = options;
      return Promise.resolve(true);
    }
  }
  return { FakeFFmpeg, harness };
});
type FakeFFmpeg = InstanceType<typeof FakeFFmpeg>;

vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: FakeFFmpeg }));
vi.mock("@ffmpeg/util", () => ({
  toBlobURL: (url: string, mime: string) => {
    harness.blobbed.push([url, mime]);
    return Promise.resolve(`blob:${url}`);
  },
}));

beforeEach(() => {
  // The module keeps one shared instance across calls; start each test without one.
  terminateFfmpeg();
  harness.instances.length = 0;
  harness.blobbed.length = 0;
});

describe("ensureFfmpeg", () => {
  it("loads the core lazily, through blob URLs of the CDN's script and wasm", async () => {
    const ff = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    expect(ff.loaded).toBe(true);
    expect(harness.blobbed.map(([url]) => url)).toEqual([
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
    ]);
    expect(ff.loadedWith).toEqual({
      coreURL: "blob:https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
      wasmURL: "blob:https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
    });
  });

  it("shares one instance across calls rather than paying the ~30MB load again", async () => {
    const first = await ensureFfmpeg();
    const second = await ensureFfmpeg();
    expect(second).toBe(first);
    expect(harness.instances).toHaveLength(1);
  });

  it("forwards log and progress events to the most recent caller's handlers", async () => {
    const early = { onLog: vi.fn(), onProgress: vi.fn() };
    const late = { onLog: vi.fn(), onProgress: vi.fn() };
    const ff = (await ensureFfmpeg(early)) as unknown as FakeFFmpeg;
    await ensureFfmpeg(late);
    ff.listeners.get("log")?.({ message: "frame=1" } as never);
    ff.listeners.get("progress")?.({ progress: 0.5, time: 1000 } as never);
    expect(late.onLog).toHaveBeenCalledWith("frame=1");
    expect(late.onProgress).toHaveBeenCalledWith({ progress: 0.5, time: 1000 });
    // A fresh extraction's handlers replace the last one's, not stack on top of them.
    expect(early.onLog).not.toHaveBeenCalled();
    expect(early.onProgress).not.toHaveBeenCalled();
  });
});

describe("terminateFfmpeg", () => {
  it("kills the shared instance, and the next call loads a fresh one", async () => {
    const first = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    terminateFfmpeg();
    expect(first.terminate).toHaveBeenCalled();
    const second = await ensureFfmpeg();
    expect(second).not.toBe(first);
    expect(harness.instances).toHaveLength(2);
  });

  it("is safe to call with nothing loaded", () => {
    expect(() => terminateFfmpeg()).not.toThrow();
  });
});

describe("runFfmpeg", () => {
  it("hands the command and signal to exec", async () => {
    const ff = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    const controller = new AbortController();
    await runFfmpeg(ff as never, ["-i", "in.mp4", "out.mp4"], controller.signal);
    expect(ff.exec).toHaveBeenCalledWith(["-i", "in.mp4", "out.mp4"], -1, { signal: controller.signal });
  });

  it("refuses to start against a signal already tripped", async () => {
    const ff = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    const controller = new AbortController();
    controller.abort();
    await expect(runFfmpeg(ff as never, ["-i", "in.mp4", "out.mp4"], controller.signal)).rejects.toThrow(InterruptedError);
    expect(ff.exec).not.toHaveBeenCalled();
  });

  it("lets a real encode failure through untouched", async () => {
    const ff = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    ff.exec.mockRejectedValue(new Error("Invalid data found when processing input") as never);
    await expect(runFfmpeg(ff as never, ["-i", "in.mp4", "out.mp4"])).rejects.toThrow("Invalid data found");
    expect(ff.terminate).not.toHaveBeenCalled();
  });

  it("tears the worker down on an interruption, since the encode inside it cannot be stopped", async () => {
    const ff = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    const controller = new AbortController();
    ff.exec.mockImplementation((() => {
      // What @ffmpeg/ffmpeg does on abort: reject the promise while the worker encodes on.
      controller.abort();
      return Promise.reject(new Error("called FFmpeg.terminate()"));
    }) as never);
    await expect(runFfmpeg(ff as never, ["-i", "in.mp4", "out.mp4"], controller.signal)).rejects.toThrow(InterruptedError);
    expect(ff.terminate).toHaveBeenCalled();
    // The teardown dropped the shared instance: the next extraction gets a fresh worker.
    const next = await ensureFfmpeg();
    expect(next).not.toBe(ff);
  });
});
