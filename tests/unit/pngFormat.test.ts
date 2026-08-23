// @vitest-environment node
// Blob.slice().arrayBuffer() — how pngFormatInfo reads the header — is unimplemented in jsdom, so
// these run against node's own Blob, the same way etag.test.ts does.
import { describe, expect, it } from "vitest";
import { pngFormatInfo } from "../../src/lib/pngFormat";

/** The first 26 bytes of a PNG with the given IHDR bit depth and color type. */
function pngHead(bitDepth: number, colorType: number): Blob {
  const bytes = new Uint8Array(26);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  bytes[24] = bitDepth;
  bytes[25] = colorType;
  return new Blob([bytes]);
}

describe("pngFormatInfo", () => {
  it("names the layout browsers usually write — 8-bit RGBA", async () => {
    expect(await pngFormatInfo(pngHead(8, 6))).toEqual({ pixelFormat: "rgba", bitDepth: 8 });
  });

  it("names the opaque-truecolor and 16-bit layouts in FFmpeg's own vocabulary", async () => {
    expect(await pngFormatInfo(pngHead(8, 2))).toEqual({ pixelFormat: "rgb24", bitDepth: 8 });
    expect(await pngFormatInfo(pngHead(16, 0))).toEqual({ pixelFormat: "gray16be", bitDepth: 16 });
    expect(await pngFormatInfo(pngHead(16, 6))).toEqual({ pixelFormat: "rgba64be", bitDepth: 16 });
  });

  it("reads a real encoder's output, not just headers built by hand", async () => {
    // A 1x1 transparent PNG, as encoders actually write one: 8-bit RGBA.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    expect(await pngFormatInfo(new Blob([png]))).toEqual({ pixelFormat: "rgba", bitDepth: 8 });
  });

  it("returns null for anything that is not a PNG, rather than a wrong answer", async () => {
    expect(await pngFormatInfo(new Blob([new Uint8Array(26)]))).toBeNull();
    expect(await pngFormatInfo(new Blob([new Uint8Array(4)]))).toBeNull();
  });

  it("returns null for a layout FFmpeg's vocabulary has no name for", async () => {
    // 4-bit palette is a legal PNG, but no pix_fmt name here covers it.
    expect(await pngFormatInfo(pngHead(4, 3))).toBeNull();
  });
});
