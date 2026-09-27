// @vitest-environment node
// The shared ffmpeg.wasm instance's lifecycle — lazy load, the core's integrity check, handler
// re-wiring, interruption teardown — against a stand-in for @ffmpeg/ffmpeg. Kept apart from
// ffmpeg.test.ts, which covers the pure command-building half of the module against the real thing.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureFfmpeg, FFMPEG_CORE, runFfmpeg, terminateFfmpeg } from "../../src/lib/ffmpeg";
import { IntegrityError } from "../../src/lib/pinned";
import { InterruptedError } from "@brain-bbqs/utils";

// Hoisted so the class exists by the time the mock factory below runs, which is before this file's
// own top-level statements.
const { FakeFFmpeg, harness } = vi.hoisted(() => {
  const harness = {
    instances: [] as InstanceType<typeof FakeFFmpeg>[],
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

// The genuine core, from the `@ffmpeg/core` devDependency pinned to the same version the app
// fetches: the CDN stands in for it here, so these tests also catch a pin that has drifted from it.
const coreDir = new URL("../../node_modules/@ffmpeg/core/dist/esm/", import.meta.url);
const GENUINE: Record<string, Uint8Array> = {
  [FFMPEG_CORE.core.url]: new Uint8Array(readFileSync(new URL("ffmpeg-core.js", coreDir))),
  [FFMPEG_CORE.wasm.url]: new Uint8Array(readFileSync(new URL("ffmpeg-core.wasm", coreDir))),
};

/** Serves each core file the CDN is asked for, with `overrides` replacing the genuine bytes. */
function stubCdn(overrides: Record<string, Uint8Array> = {}) {
  const fetch = vi.fn((url: string) => {
    const body = overrides[url] ?? GENUINE[url];
    return Promise.resolve(body ? new Response(body) : new Response(null, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

let createObjectURL: ReturnType<typeof vi.spyOn<typeof URL, "createObjectURL">>;

beforeEach(() => {
  // The module keeps one shared instance across calls; start each test without one.
  terminateFfmpeg();
  harness.instances.length = 0;
  stubCdn();
  let n = 0;
  createObjectURL = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++n}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ensureFfmpeg", () => {
  it("loads the core lazily, through blob URLs of the CDN's script and wasm once both match their pins", async () => {
    const fetch = stubCdn();
    const ff = (await ensureFfmpeg()) as unknown as FakeFFmpeg;
    expect(ff.loaded).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js",
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm",
    ]);
    const blobs = createObjectURL.mock.calls.map(([blob]) => blob as Blob);
    expect(blobs.map((blob) => [blob.type, blob.size])).toEqual([
      ["text/javascript", GENUINE[FFMPEG_CORE.core.url].length],
      ["application/wasm", GENUINE[FFMPEG_CORE.wasm.url].length],
    ]);
    expect(ff.loadedWith).toEqual({ coreURL: "blob:test/1", wasmURL: "blob:test/2" });
  });

  it.each([
    ["script", FFMPEG_CORE.core.url],
    ["wasm", FFMPEG_CORE.wasm.url],
  ])("refuses a tampered %s, creating no blob URL and loading nothing", async (_, url) => {
    const tampered = new Uint8Array(GENUINE[url]);
    tampered[tampered.length - 1] ^= 1;
    stubCdn({ [url]: tampered });
    const error = await ensureFfmpeg().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrityError);
    expect((error as IntegrityError).url).toBe(url);
    expect(createObjectURL).not.toHaveBeenCalled();
    const [ff] = harness.instances;
    expect(ff.loaded).toBe(false);
    expect(ff.loadedWith).toBe(null);

    // Nothing was kept from the refused load: the next call fetches and checks the core afresh.
    stubCdn();
    expect((await ensureFfmpeg()) as unknown as FakeFFmpeg).toBe(ff);
    expect(ff.loaded).toBe(true);
  });

  it("shares one instance across calls rather than paying the ~30MB load again", async () => {
    const fetch = stubCdn();
    const first = await ensureFfmpeg();
    const second = await ensureFfmpeg();
    expect(second).toBe(first);
    expect(harness.instances).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
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
