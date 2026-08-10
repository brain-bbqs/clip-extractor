// @vitest-environment node
// Blob.slice().arrayBuffer() — how hashPart streams a file — is unimplemented in jsdom, so these
// run against node's own Blob instead of this suite's default DOM environment.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { combineDigests, computeDandiEtag, planParts } from "../../src/lib/etag";
import type { FilePart } from "../../src/lib/types";

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

describe("planParts", () => {
  it("plans a single part for a small file", () => {
    expect(planParts(1024)).toEqual([{ number: 1, offset: 0, size: 1024 }]);
  });

  it("splits at the 64MB default part size, leaving the remainder last", () => {
    expect(planParts(64 * MB + 10)).toEqual([
      { number: 1, offset: 0, size: 64 * MB },
      { number: 2, offset: 64 * MB, size: 10 },
    ]);
  });

  it("covers the whole file exactly, with no gaps or overlap", () => {
    const size = 200 * MB + 7;
    const parts = planParts(size);
    expect(parts.reduce((sum, p) => sum + p.size, 0)).toBe(size);
    parts.forEach((p, i) => expect(p.offset).toBe(i === 0 ? 0 : parts[i - 1].offset + parts[i - 1].size));
  });

  it("rejects an empty file, which DANDI cannot store", () => {
    expect(() => planParts(0)).toThrow(/Empty files/);
  });
});

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

describe("combineDigests", () => {
  it("suffixes the digest with the part count", () => {
    expect(combineDigests(new Uint8Array(32), 2).endsWith("-2")).toBe(true);
  });
});
