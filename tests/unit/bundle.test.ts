// @vitest-environment node
// Blob.slice().arrayBuffer() — how the tar is streamed out — is unimplemented in jsdom, so these
// run against node's own Blob instead of this suite's default DOM environment (as etag.test.ts
// does, for the same reason).
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitUstarPath, tarGzip, type BundleEntry } from "../../src/lib/bundle";

// The saved bundle is the only artifact that leaves the page whole, so these unpack it the way a
// real `tar xzf` would: gunzip, then walk the 512-byte blocks.

const BLOCK = 512;
const decoder = new TextDecoder();

/** Reads a NUL/space-terminated header field. */
function field(header: Uint8Array, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const end = raw.findIndex((b) => b === 0 || b === 0x20);
  return decoder.decode(end === -1 ? raw : raw.subarray(0, end));
}

interface UnpackedEntry {
  path: string;
  mode: string;
  typeflag: number;
  mtime: number;
  bytes: Uint8Array;
}

async function gunzip(blob: Blob): Promise<Uint8Array> {
  const stream = new DecompressionStream("gzip");
  const done = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(new Uint8Array(await blob.arrayBuffer()));
  await writer.close();
  return new Uint8Array(await done);
}

async function unpack(bundle: Blob): Promise<UnpackedEntry[]> {
  const tar = await gunzip(bundle);
  expect(tar.length % BLOCK, "a tar is a whole number of 512-byte blocks").toBe(0);
  const entries: UnpackedEntry[] = [];
  for (let offset = 0; offset + BLOCK <= tar.length;) {
    const header = tar.subarray(offset, offset + BLOCK);
    // The archive ends at the first of its two zero blocks.
    if (header.every((b) => b === 0)) break;

    // The stored checksum is computed over a header whose own field reads as eight spaces.
    const stored = parseInt(field(header, 148, 8), 8);
    const summed = header.reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 0x20 : byte), 0);
    expect(summed, `checksum of ${field(header, 0, 100)}`).toBe(stored);
    expect(field(header, 257, 6)).toBe("ustar");

    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const size = parseInt(field(header, 124, 12), 8);
    offset += BLOCK;
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      mode: field(header, 100, 8),
      typeflag: header[156],
      mtime: parseInt(field(header, 136, 12), 8),
      bytes: tar.subarray(offset, offset + size),
    });
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

const modified = new Date("2026-08-10T03:10:53.000Z");

function entry(path: string, text: string): BundleEntry {
  return { path, blob: new Blob([text], { type: "text/plain" }) };
}

describe("tarGzip", () => {
  it("round-trips every file, in the order it was given, with its bytes intact", async () => {
    const bundle = await tarGzip(
      [entry("dir/first.txt", "hello"), entry("dir/second.json", '{"a":1}'), entry("dir/third.bin", "x".repeat(1500))],
      modified,
    );
    const unpacked = await unpack(bundle);
    expect(unpacked.map((e) => e.path)).toEqual(["dir/first.txt", "dir/second.json", "dir/third.bin"]);
    expect(decoder.decode(unpacked[0].bytes)).toBe("hello");
    expect(decoder.decode(unpacked[1].bytes)).toBe('{"a":1}');
    // A file that is not a whole number of blocks is padded, and the padding is not handed back.
    expect(unpacked[2].bytes).toHaveLength(1500);
  });

  it("writes gzip's own magic bytes and labels the blob as gzip", async () => {
    const bundle = await tarGzip([entry("a.txt", "hello")], modified);
    expect(bundle.type).toBe("application/gzip");
    const head = new Uint8Array(await bundle.slice(0, 3).arrayBuffer());
    expect([...head]).toEqual([0x1f, 0x8b, 0x08]);
  });

  it("stamps every file with the moment the selection was extracted, not the clock", async () => {
    const [first, second] = await unpack(await tarGzip([entry("a.txt", "a"), entry("b.txt", "b")], modified));
    expect(first.mtime).toBe(Math.floor(modified.getTime() / 1000));
    expect(second.mtime).toBe(first.mtime);
  });

  it("marks each entry as a plain readable file", async () => {
    const [only] = await unpack(await tarGzip([entry("a.txt", "a")], modified));
    expect(only.typeflag).toBe(0x30); // "0"
    expect(only.mode).toBe("0000644");
  });

  it("closes the archive with two zero blocks, as a tar reader expects", async () => {
    const tar = await gunzip(await tarGzip([entry("a.txt", "hello")], modified));
    expect([...tar.subarray(tar.length - 2 * BLOCK)].every((b) => b === 0)).toBe(true);
  });

  it("carries a deep upload path through ustar's split name fields", async () => {
    const path =
      "sourcedata/raw/clip-extractor/date-20260810_time-031053_type-snippet/name-a+very+long+source+name_range-120+300_type-snippet_video.mp4";
    const [only] = await unpack(await tarGzip([{ path, blob: new Blob(["mp4"]) }], modified));
    expect(only.path).toBe(path);
  });

  it("packs an empty selection into a valid, empty archive", async () => {
    expect(await unpack(await tarGzip([], modified))).toEqual([]);
  });
});

describe("tarGzip, when the machinery underneath gives out", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names the missing piece on a browser without CompressionStream", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    await expect(tarGzip([entry("a.txt", "a")], modified)).rejects.toThrow(
      /cannot compress a saved bundle \(CompressionStream is unavailable\)/,
    );
  });

  it("surfaces a file that cannot be read as the failure, not as an unhandled rejection", async () => {
    const unreadable: BundleEntry = {
      path: "dir/broken.mp4",
      blob: {
        size: 10,
        slice: () => {
          throw new Error("unreadable source blob");
        },
      } as unknown as Blob,
    };
    await expect(tarGzip([entry("a.txt", "a"), unreadable], modified)).rejects.toThrow("unreadable source blob");
  });
});

describe("splitUstarPath", () => {
  it("leaves a short path in the name field alone", () => {
    expect(splitUstarPath("sourcedata/raw/clip-extractor/stamp/clip.mp4")).toEqual({
      name: "sourcedata/raw/clip-extractor/stamp/clip.mp4",
      prefix: "",
    });
  });

  it("splits a long path at a directory boundary, keeping the prefix as short as it can", () => {
    const name = `${"a".repeat(90)}.mp4`;
    const { name: split, prefix } = splitUstarPath(`sourcedata/raw/clip-extractor/stamp/${name}`);
    // The earlier cuts leave more than 100 bytes in `name`; this is the first one that fits.
    expect(prefix).toBe("sourcedata/raw/clip-extractor");
    expect(split).toBe(`stamp/${name}`);
  });

  it("measures the fields in bytes, not characters", () => {
    // 44 characters, but 108 bytes — a character count would see nothing to split here.
    const { name, prefix } = splitUstarPath(`somedir/${"あ".repeat(32)}.mp4`);
    expect(prefix).toBe("somedir");
    expect(name).toBe(`${"あ".repeat(32)}.mp4`);
  });

  it("refuses a file name that cannot fit however it is split", () => {
    expect(() => splitUstarPath(`dir/${"a".repeat(120)}.mp4`)).toThrow(/too long/);
  });
});
