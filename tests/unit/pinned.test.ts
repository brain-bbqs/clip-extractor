// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "hash-wasm";
import { fetchPinned, IntegrityError } from "../../src/lib/pinned";

const CORE_URL = "https://cdn.example.test/pkg@1.0.0/dist/core.wasm";
const GENUINE = new TextEncoder().encode("the pinned bytes");

function stubFetch(body: Uint8Array, status = 200) {
  const fetch = vi.fn(() => Promise.resolve(new Response(body, { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPinned", () => {
  it("hands back the bytes as a Blob of the given type when they match the pin", async () => {
    const fetch = stubFetch(GENUINE);
    const blob = await fetchPinned({ url: CORE_URL, sha256: await sha256(GENUINE), mimeType: "application/wasm" });
    expect(fetch).toHaveBeenCalledWith(CORE_URL);
    expect(blob.type).toBe("application/wasm");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(GENUINE);
  });

  it("accepts a pin written in uppercase hex", async () => {
    stubFetch(GENUINE);
    const blob = await fetchPinned({ url: CORE_URL, sha256: (await sha256(GENUINE)).toUpperCase(), mimeType: "text/javascript" });
    expect(blob.size).toBe(GENUINE.length);
  });

  it("refuses bytes that differ from the pin, naming the file and where it came from", async () => {
    const tampered = new TextEncoder().encode("the pinned bytez");
    stubFetch(tampered);
    const expected = await sha256(GENUINE);
    const error = await fetchPinned({ url: CORE_URL, sha256: expected, mimeType: "application/wasm" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrityError);
    const integrity = error as IntegrityError;
    expect(integrity.message).toBe(
      "core.wasm from cdn.example.test is not the file this app expects, so it was not loaded. " +
        "Try again later, and report it if this keeps happening.",
    );
    expect(integrity.url).toBe(CORE_URL);
    expect(integrity.expected).toBe(expected);
    expect(integrity.actual).toBe(await sha256(tampered));
  });

  it("reports a failed download as such rather than as a mismatch", async () => {
    stubFetch(new Uint8Array(), 404);
    const error = await fetchPinned({ url: CORE_URL, sha256: await sha256(GENUINE), mimeType: "application/wasm" }).catch(
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(IntegrityError);
    expect((error as Error).message).toBe(`Could not download ${CORE_URL} (HTTP 404).`);
  });
});
