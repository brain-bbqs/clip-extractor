// @vitest-environment node
// Blob.slice().arrayBuffer() — how hashPart streams a file — is unimplemented in jsdom, so these
// run against node's own Blob instead of this suite's default DOM environment.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planParts, type FilePart } from "@brain-bbqs/ember-client";
import { computeDandiEtag, computeMd5, computeSha256 } from "../../src/lib/etag";
import { InterruptedError } from "@brain-bbqs/utils";

const MB = 2 ** 20;

function filled(size: number): Uint8Array {
  return new Uint8Array(size).map((_, i) => i % 251);
}

/** The dandi-etag as defined by dandischema: MD5 of the concatenated per-part MD5s, suffixed with
 * the part count. Computed here with node's crypto so the test is independent of spark-md5. */
function referenceEtag(bytes: Uint8Array, parts: FilePart[]): string {
  const inner = Buffer.concat(
    parts.map((p) =>
      createHash("md5")
        .update(bytes.subarray(p.offset, p.offset + p.size))
        .digest(),
    ),
  );
  return `${createHash("md5").update(inner).digest("hex")}-${parts.length}`;
}

describe("computeDandiEtag", () => {
  it("matches the reference dandi-etag for a single-part blob", async () => {
    const bytes = filled(4096);
    const parts = planParts(bytes.length);
    expect(await computeDandiEtag(new Blob([bytes]), parts)).toBe(referenceEtag(bytes, parts));
  });

  it("matches the reference dandi-etag across a multi-part layout", async () => {
    const bytes = filled(3000);
    const parts: FilePart[] = [
      { number: 1, offset: 0, size: 1000 },
      { number: 2, offset: 1000, size: 1000 },
      { number: 3, offset: 2000, size: 1000 },
    ];
    expect(await computeDandiEtag(new Blob([bytes]), parts)).toBe(referenceEtag(bytes, parts));
  });

  it("matches the reference when a part spans several 16MB hash chunks", async () => {
    const bytes = filled(17 * MB);
    const parts = planParts(bytes.length);
    expect(parts).toHaveLength(1);
    expect(await computeDandiEtag(new Blob([bytes]), parts)).toBe(referenceEtag(bytes, parts));
  });

  it("reports monotonic progress ending at 1", async () => {
    const seen: number[] = [];
    await computeDandiEtag(new Blob([filled(2048)]), planParts(2048), (f) => seen.push(f));
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe("computeMd5 / computeSha256", () => {
  // Both stream the blob in 16MB reads rather than buffering it whole, so the multi-chunk cases
  // below are the ones that actually exercise that loop rather than a single pass over one slice.
  const reference = (algo: string, bytes: Uint8Array) => createHash(algo).update(bytes).digest("hex");

  it("matches node's own digest for a blob smaller than one chunk", async () => {
    const bytes = filled(2048);
    expect(await computeMd5(new Blob([bytes]))).toBe(reference("md5", bytes));
    expect(await computeSha256(new Blob([bytes]))).toBe(reference("sha256", bytes));
  });

  it("matches it across the chunk boundary too, where the streaming loop actually runs", async () => {
    const bytes = filled(40 * MB);
    expect(await computeMd5(new Blob([bytes]))).toBe(reference("md5", bytes));
    expect(await computeSha256(new Blob([bytes]))).toBe(reference("sha256", bytes));
  });

  it("matches it for an empty blob, which the loop never enters for", async () => {
    expect(await computeSha256(new Blob([]))).toBe(reference("sha256", new Uint8Array(0)));
  });

  it("reports progress that ends at 1", async () => {
    const seen: number[] = [];
    await computeSha256(new Blob([filled(40 * MB)]), (f) => seen.push(f));
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe("stopping a hash partway through", () => {
  // Hashing a multi-gigabyte source is the longest single step a delivery has (three passes over
  // every byte, see checksumBlob), so the loop reads the interrupt at every 16MB chunk boundary
  // rather than running to the end of the file whatever the visitor asked for.
  it("gives up at the next chunk boundary once the delivery is stopped", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    await expect(
      computeSha256(
        new Blob([filled(40 * MB)]),
        (f) => {
          seen.push(f);
          controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toThrow(InterruptedError);
    // One chunk's worth of progress, and then nothing: the remaining 24MB were never read.
    expect(seen).toHaveLength(1);
  });

  it("reads no bytes at all when the delivery was already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const bytes = new Blob([filled(2048)]);
    await expect(computeMd5(bytes, undefined, controller.signal)).rejects.toThrow(InterruptedError);
    await expect(computeDandiEtag(bytes, planParts(2048), undefined, controller.signal)).rejects.toThrow(InterruptedError);
  });
});

describe("a source that changes while it is being hashed", () => {
  // A File is a live handle on something the visitor can still edit or unmount; a digest folded from
  // part-old, part-new bytes would name a blob that never existed, so a short read stops the hash.
  const shrinking = (claimedSize: number): Blob => {
    const actual = new Blob([filled(claimedSize - 1)]);
    return { size: claimedSize, slice: (start?: number, end?: number) => actual.slice(start, end) } as Blob;
  };

  it.each([
    ["computeDandiEtag", (b: Blob) => computeDandiEtag(b, planParts(b.size))],
    ["computeMd5", (b: Blob) => computeMd5(b)],
    ["computeSha256", (b: Blob) => computeSha256(b)],
  ])("%s refuses it, asking for the source to be loaded again", async (_name, hash) => {
    await expect(hash(shrinking(2048))).rejects.toThrow("The source file changed while hashing — please re-load it.");
  });
});
