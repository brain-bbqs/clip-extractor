import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPartWithRetry } from "../../src/lib/s3";

/** One scripted outcome for the next FakeXHR send. */
interface ScriptedResponse {
  /** HTTP status to answer with; ignored when `network` or `hang` is set. */
  status?: number;
  /** Raw ETag header value (still quoted, as S3 sends it), or null for a missing header. */
  etag?: string | null;
  /** Simulate a network-level failure (onerror) instead of a response. */
  network?: boolean;
  /** Never respond, so only an abort can settle the request. */
  hang?: boolean;
}

class FakeXHR {
  static script: ScriptedResponse[] = [];
  static sent: { url: string; blob: Blob }[] = [];

  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  private etag: string | null = null;
  private url = "";
  private aborted = false;

  open(_method: string, url: string): void {
    this.url = url;
  }

  getResponseHeader(name: string): string | null {
    return name === "ETag" ? this.etag : null;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  send(blob: Blob): void {
    FakeXHR.sent.push({ url: this.url, blob });
    const outcome = FakeXHR.script.shift() ?? { status: 200, etag: '"deadbeef"' };
    queueMicrotask(() => {
      if (this.aborted || outcome.hang) return;
      if (outcome.network) {
        this.onerror?.();
        return;
      }
      this.upload.onprogress?.({ lengthComputable: true, loaded: blob.size });
      this.status = outcome.status ?? 200;
      this.etag = outcome.etag !== undefined ? outcome.etag : '"deadbeef"';
      this.onload?.();
    });
  }
}

beforeEach(() => {
  FakeXHR.script = [];
  FakeXHR.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const blob = new Blob(["0123456789"]);

describe("uploadPartWithRetry", () => {
  it("resolves with the ETag header stripped of quotes and reports progress", async () => {
    FakeXHR.script = [{ status: 200, etag: '"abc123"' }];
    const progress: number[] = [];

    const etag = await uploadPartWithRetry("https://s3.example/part-1", blob, (n) => progress.push(n));

    expect(etag).toBe("abc123");
    expect(progress).toEqual([blob.size]);
    expect(FakeXHR.sent).toHaveLength(1);
    expect(FakeXHR.sent[0].url).toBe("https://s3.example/part-1");
  });

  it("fails immediately (no retry) when S3 accepts the part but hides the ETag header", async () => {
    FakeXHR.script = [{ status: 200, etag: null }];

    await expect(uploadPartWithRetry("https://s3.example/part-1", blob, () => {})).rejects.toThrow(/ETag response header is not readable/);
    expect(FakeXHR.sent).toHaveLength(1);
  });

  it("retries a network error with backoff, resetting reported progress between attempts", async () => {
    vi.useFakeTimers();
    FakeXHR.script = [{ network: true }, { status: 200, etag: '"ok"' }];
    const progress: number[] = [];

    const promise = uploadPartWithRetry("https://s3.example/part-1", blob, (n) => progress.push(n));
    await vi.advanceTimersByTimeAsync(1500);

    await expect(promise).resolves.toBe("ok");
    expect(FakeXHR.sent).toHaveLength(2);
    expect(progress).toEqual([0, blob.size]);
  });

  it("retries an HTTP failure and rethrows the last error once attempts run out", async () => {
    vi.useFakeTimers();
    FakeXHR.script = [{ status: 500 }, { status: 503 }, { status: 500 }];

    const promise = uploadPartWithRetry("https://s3.example/part-1", blob, () => {});
    const settled = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1500 + 3000 + 6000);

    expect(await settled).toEqual(new Error("S3 part upload failed with HTTP 500"));
    expect(FakeXHR.sent).toHaveLength(3);
  });

  it("throws without sending anything when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(uploadPartWithRetry("https://s3.example/part-1", blob, () => {}, controller.signal)).rejects.toThrow(/cancelled/i);
    expect(FakeXHR.sent).toHaveLength(0);
  });

  it("aborts the in-flight request when the signal fires, without retrying", async () => {
    FakeXHR.script = [{ hang: true }];
    const controller = new AbortController();

    const promise = uploadPartWithRetry("https://s3.example/part-1", blob, () => {}, controller.signal);
    const settled = promise.catch((e: unknown) => e);
    controller.abort();

    expect(await settled).toEqual(new Error("Upload cancelled."));
    expect(FakeXHR.sent).toHaveLength(1);
  });
});
