import { describe, expect, it, vi } from "vitest";
import { memoOne } from "../../src/lib/memo";

describe("memoOne", () => {
  it("produces a value the first time a key is asked for", async () => {
    const produce = vi.fn(() => Promise.resolve("clip"));
    expect(await memoOne<string>()("a", produce)).toBe("clip");
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("hands back the same value, untouched, when the key repeats", async () => {
    const once = memoOne<{ id: number }>();
    const produce = vi.fn(() => Promise.resolve({ id: 1 }));
    const first = await once("a", produce);
    const second = await once("a", produce);
    // The identical object, not a copy: this is what lets an upload send the very blob a save wrote.
    expect(second).toBe(first);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("produces again for a different key", async () => {
    const once = memoOne<string>();
    expect(await once("a", () => Promise.resolve("first"))).toBe("first");
    expect(await once("b", () => Promise.resolve("second"))).toBe("second");
  });

  it("holds only the newest key, so going back re-produces", async () => {
    const once = memoOne<string>();
    const produce = vi.fn(() => Promise.resolve("again"));
    await once("a", () => Promise.resolve("first"));
    await once("b", () => Promise.resolve("second"));
    expect(await once("a", produce)).toBe("again");
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("caches nothing when producing fails, and keeps what it already held", async () => {
    const once = memoOne<string>();
    await once("a", () => Promise.resolve("kept"));
    await expect(once("b", () => Promise.reject(new Error("encode failed")))).rejects.toThrow("encode failed");
    // The failed key is not remembered as empty, and the earlier one is still there to be found.
    expect(await once("b", () => Promise.resolve("retried"))).toBe("retried");
    expect(await once("a", () => Promise.resolve("re-produced"))).toBe("re-produced");
  });
});
