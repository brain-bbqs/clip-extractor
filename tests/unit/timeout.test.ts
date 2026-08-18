import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../../src/lib/timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves with the promise's own value when it settles before the timer", async () => {
    await expect(withTimeout(Promise.resolve("frame"), 30_000, "too slow")).resolves.toBe("frame");
  });

  it("rejects with the promise's own error when it settles before the timer", async () => {
    await expect(withTimeout(Promise.reject(new Error("codec error")), 30_000, "too slow")).rejects.toThrow("codec error");
  });

  it("rejects with the timeout message once the timer runs out first", async () => {
    vi.useFakeTimers();
    // Never settles: standing in for a fetch nothing answers, or a decoder waiting on a frame that
    // never arrives.
    const stuck = withTimeout(new Promise(() => {}), 30_000, "took too long");
    // The rejection has to be caught in the same tick it is created, before the clock ever moves —
    // catching it only afterwards would leave the promise briefly unhandled, which Node flags even
    // once it is caught here.
    const failure = stuck.catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(failure).resolves.toEqual(new Error("took too long"));
  });

  it("does not fire once the promise has already settled", async () => {
    vi.useFakeTimers();
    const result = withTimeout(Promise.resolve("frame"), 30_000, "took too long");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toBe("frame");
  });
});
