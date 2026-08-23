// What a PNG says about its own pixels, read straight off its IHDR header — the encoder's word,
// not an assumption about what canvas.toBlob produced. Browsers are free to write RGB or RGBA,
// so the extracted frame's `ImagePixelFormat`/`ImageBitDepth` sidecar keys (BEP047) come from the
// bytes actually written rather than from a guess either way.

/** A PNG's stored pixel layout, in the vocabulary the sidecar uses: BEP047's `ImagePixelFormat`
 * takes FFmpeg's `pix_fmt` naming and `ImageBitDepth` the bits per channel. */
export interface PngFormat {
  pixelFormat: string;
  bitDepth: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// IHDR's color type crossed with its bit depth, named as FFmpeg's `pix_fmt` does. The combinations
// the PNG spec does not allow (16-bit palette, say) simply have no name here and yield null.
const PIX_FMT_NAMES: Partial<Record<number, Partial<Record<number, string>>>> = {
  8: { 0: "gray", 2: "rgb24", 3: "pal8", 4: "ya8", 6: "rgba" },
  16: { 0: "gray16be", 2: "rgb48be", 4: "ya16be", 6: "rgba64be" },
};

/** Reads the pixel format and per-channel bit depth off a PNG's IHDR — the first chunk, at a fixed
 * offset, so only the first 26 bytes are ever pulled out of the blob. Null for anything that is not
 * a PNG, or a layout FFmpeg's vocabulary has no name for — omitted from the sidecar rather than
 * invented, per `TechnicalDetail`'s own rule (lib/provenance.ts). */
export async function pngFormatInfo(blob: Blob): Promise<PngFormat | null> {
  const head = new Uint8Array(await blob.slice(0, 26).arrayBuffer());
  if (head.length < 26) return null;
  if (PNG_SIGNATURE.some((byte, i) => head[i] !== byte)) return null;
  // The IHDR chunk type sits right after the signature and its 4-byte length; anything else in
  // that position is not a PNG the spec allows.
  if (String.fromCharCode(...head.subarray(12, 16)) !== "IHDR") return null;
  const bitDepth = head[24];
  const pixelFormat = PIX_FMT_NAMES[bitDepth]?.[head[25]];
  return pixelFormat ? { pixelFormat, bitDepth } : null;
}
