import { describe, expect, it } from "vitest";
import { buildFrameOrder, decodeIndex, looksLikeIsoBmff } from "../../src/lib/video";
import type { SleapVideoBackend } from "../../src/lib/types";

function backendWithTimes(times: number[] | null): SleapVideoBackend {
  return {
    getFrame: () => Promise.reject(new Error("not used")),
    getFrameTimes: times ? () => Promise.resolve(times) : undefined,
  };
}

describe("buildFrameOrder", () => {
  it("returns null when the backend can't report frame times", async () => {
    expect(await buildFrameOrder(backendWithTimes(null))).toBeNull();
  });

  it("returns null when decode order already matches display order", async () => {
    expect(await buildFrameOrder(backendWithTimes([0, 1, 2, 3]))).toBeNull();
  });

  it("returns a display->decode map when frames are out of order (B-frames)", async () => {
    const order = await buildFrameOrder(backendWithTimes([0, 2, 1, 3]));
    expect(order).toEqual([0, 2, 1, 3]);
  });

  it("returns null when getFrameTimes rejects", async () => {
    const backend: SleapVideoBackend = {
      getFrame: () => Promise.reject(new Error("not used")),
      getFrameTimes: () => Promise.reject(new Error("boom")),
    };
    expect(await buildFrameOrder(backend)).toBeNull();
  });
});

describe("decodeIndex", () => {
  it("passes through the display index when there is no reorder", () => {
    expect(decodeIndex(null, 5)).toBe(5);
  });

  it("maps through the frame order when one is present", () => {
    expect(decodeIndex([0, 2, 1, 3], 2)).toBe(1);
  });
});

/** The first bytes of a file: a four-byte box length followed by `type`, which is where an ISO base
 * media file names itself and where a RIFF file happens to put something else entirely. */
function head(type: string, length = 32): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setUint32(0, length);
  for (let i = 0; i < 4; i++) bytes[4 + i] = type.charCodeAt(i);
  return bytes;
}

describe("looksLikeIsoBmff", () => {
  it("recognizes a file that opens on a box type an MP4 can open on", () => {
    for (const type of ["ftyp", "moov", "mdat", "free", "skip", "wide", "styp", "pnot"]) {
      expect(looksLikeIsoBmff(head(type))).toBe(true);
    }
  });

  it("refuses an AVI, whose leading bytes mp4box would wait on the rest of forever", () => {
    const avi = new Uint8Array([...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from("AVI ")]);
    expect(looksLikeIsoBmff(avi)).toBe(false);
  });

  it("refuses the other containers that reach it, and anything too short to say", () => {
    expect(looksLikeIsoBmff(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe(false);
    expect(looksLikeIsoBmff(new Uint8Array([0x47, 0x40, 0x00, 0x10, 0, 0, 0, 0]))).toBe(false);
    expect(looksLikeIsoBmff(new Uint8Array())).toBe(false);
    expect(looksLikeIsoBmff(head("ftyp").subarray(0, 7))).toBe(false);
  });
});
