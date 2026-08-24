import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import type { InputVideoTrack, VideoSamplePixelFormat } from "mediabunny";
import type { TechnicalDetail } from "./provenance";

// What a video says about its own codec and its own pixels, read straight off the container and one
// decoded frame — the file's word, not an assumption about what the encoder was asked for. This is
// lib/pngFormat.ts's counterpart for the moving pictures: every clip this app writes goes through
// here on its way to a sidecar (see lib/extract.ts), so BEP047's `VideoCodec`, `VideoCodecRFC6381`,
// `ImagePixelFormat` and `ImageBitDepth` describe the bytes that actually landed.
//
// Reading them rather than declaring them is what makes those keys sayable at all here. The command
// line only ever knows part of the answer: a stream copy carries whatever the source held, an ffmpeg
// re-encode is told a pixel format but not the profile and level x264 will settle on, and a
// mediabunny re-encode is told neither. Every one of those files can be opened afterwards, though,
// and then all four keys are simply there to be read.

/** What a decoded frame's own pixel format says about it, in BEP047's own vocabulary —
 * `ImagePixelFormat`'s FFmpeg `pix_fmt` naming (`"yuv420p"`, `"yuv420p10le"`, …) and
 * `ImageBitDepth`'s plain integer, rather than mediabunny's WebCodecs-style format string
 * (`"I420"`, `"I420P10"`, …) directly. */
export interface PixelFormatInfo {
  pixelFormat: string;
  bitDepth: number;
}

// mediabunny names a decoded frame's pixel format after the WebCodecs spec
// (https://www.w3.org/TR/webcodecs/#pixel-format); BEP047 asks for FFmpeg's own `pix_fmt` naming
// instead. The two vocabularies name the same handful of planar YUV and packed RGB layouts, just
// with different spellings — this is that translation, not a guess: every WebCodecs format
// mediabunny can produce (see VIDEO_SAMPLE_PIXEL_FORMATS in mediabunny's own sample.ts) has a real
// FFmpeg pix_fmt counterpart named here.
const YUV_PIXEL_FORMAT = /^I(420|422|444)(A)?(P10|P12)?$/;
const PACKED_PIXEL_FORMATS: Record<string, string> = { NV12: "nv12", RGBA: "rgba", RGBX: "rgb0", BGRA: "bgra", BGRX: "bgr0" };

export function pixelFormatInfo(format: VideoSamplePixelFormat): PixelFormatInfo | null {
  const yuv = YUV_PIXEL_FORMAT.exec(format);
  if (yuv) {
    const [, chroma, alpha, depthSuffix] = yuv;
    const bitDepth = depthSuffix === "P10" ? 10 : depthSuffix === "P12" ? 12 : 8;
    const depthTag = depthSuffix ? `${bitDepth}le` : "";
    return { pixelFormat: `yuv${alpha ? "a" : ""}${chroma}p${depthTag}`, bitDepth };
  }
  const packed = PACKED_PIXEL_FORMATS[format];
  return packed ? { pixelFormat: packed, bitDepth: 8 } : null;
}

/** The pixel layout of a track's frames, decoded from the first of them: it is a property of the
 * pictures rather than of the container, and every frame of one track shares it. Null on a track
 * this browser cannot decode, or a layout the vocabulary above has no name for. */
async function decodedPixelFormat(track: InputVideoTrack): Promise<PixelFormatInfo | null> {
  try {
    if (!(await track.canDecode())) return null;
    const sample = await new VideoSampleSink(track).getSample(await track.getFirstTimestamp());
    const info = sample?.format ? pixelFormatInfo(sample.format) : null;
    sample?.close();
    return info;
  } catch {
    return null;
  }
}

/** Reads whatever a just-written video file says about itself, in the shape a sidecar's technical
 * keys take. Best effort throughout: anything the file does not answer for is left out rather than
 * guessed, per `TechnicalDetail`'s own rule (lib/provenance.ts), so a blob no demuxer here
 * understands yields an empty record instead of throwing. */
export async function videoFormatInfo(blob: Blob): Promise<TechnicalDetail> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return {};
    const detail: TechnicalDetail = {};
    if (track.codec) detail.codec = track.codec;
    // Some tracks name a codec loosely without a full parameter string being derivable from them,
    // which is a real "don't know" rather than a failure to read the file.
    const codecRFC6381 = await track.getCodecParameterString().catch(() => null);
    if (codecRFC6381) detail.codecRFC6381 = codecRFC6381;
    const pixel = await decodedPixelFormat(track);
    if (pixel) {
      detail.pixelFormat = pixel.pixelFormat;
      detail.bitDepth = pixel.bitDepth;
    }
    return detail;
  } catch {
    return {};
  } finally {
    input.dispose();
  }
}
