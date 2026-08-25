import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { AudioDetail } from "./provenance";

// What a media file says about its own sound, read straight off the container — lib/videoFormat.ts's
// counterpart for the track BEP047 names with `AudioCodec`, `AudioSampleRate`, `AudioChannelCount`,
// `AudioBitDepth` and `AudioCodecRFC6381`.
//
// Only one file this app writes ever has an audio track to describe: the copy of the source video
// carried into `sourcedata/` untouched. Everything this app produces is silent by design — the
// frame-exact cut and the stream copy both drop audio (see lib/ffmpeg.ts), so a derivative keeps
// BEP047's plain `_video` suffix while the source copy takes `_audiovideo` when it has sound (see
// lib/bidsPath.ts's `sourcedataOriginalFilename`).

/** An audio codec named the way BEP047 asks for it (FFmpeg's own codec name), plus the bits per
 * sample that name itself establishes — see {@link audioCodecInfo}. */
export interface AudioCodecInfo {
  codec: string;
  /** Only for the PCM family, whose codec name *is* its sample format; absent for everything else,
   * where nothing short of decoding the stream would say. */
  bitDepth?: number;
}

// mediabunny names audio codecs after the WebCodecs registry
// (https://www.w3.org/TR/webcodecs-codec-registry/), which spells the PCM family `pcm-s16`,
// `pcm-f32be`, `ulaw`, …; BEP047 asks for FFmpeg's own naming (`pcm_s16le`, `pcm_f32be`,
// `pcm_mulaw`, …) instead. The two vocabularies name the same layouts, just with different
// spellings — this is that translation, listing every PCM codec mediabunny can report (see
// PCM_AUDIO_CODECS in mediabunny's own codec.ts). Each of those names also fixes the sample width,
// which is what makes `AudioBitDepth` sayable here at all: BEP047 asks for it on uncompressed and
// losslessly compressed audio, and for uncompressed audio the codec name is the answer.
//
// The compressed codecs mediabunny knows (`aac`, `opus`, `mp3`, `vorbis`, `flac`, `ac3`, `eac3`)
// are already spelled the way FFmpeg spells them, so they pass through untranslated.
const PCM_AUDIO_CODECS: Record<string, AudioCodecInfo> = {
  "pcm-s16": { codec: "pcm_s16le", bitDepth: 16 },
  "pcm-s16be": { codec: "pcm_s16be", bitDepth: 16 },
  "pcm-s24": { codec: "pcm_s24le", bitDepth: 24 },
  "pcm-s24be": { codec: "pcm_s24be", bitDepth: 24 },
  "pcm-s32": { codec: "pcm_s32le", bitDepth: 32 },
  "pcm-s32be": { codec: "pcm_s32be", bitDepth: 32 },
  "pcm-f32": { codec: "pcm_f32le", bitDepth: 32 },
  "pcm-f32be": { codec: "pcm_f32be", bitDepth: 32 },
  "pcm-f64": { codec: "pcm_f64le", bitDepth: 64 },
  "pcm-f64be": { codec: "pcm_f64be", bitDepth: 64 },
  "pcm-u8": { codec: "pcm_u8", bitDepth: 8 },
  "pcm-s8": { codec: "pcm_s8", bitDepth: 8 },
  ulaw: { codec: "pcm_mulaw", bitDepth: 8 },
  alaw: { codec: "pcm_alaw", bitDepth: 8 },
};

export function audioCodecInfo(codec: string): AudioCodecInfo {
  return PCM_AUDIO_CODECS[codec] ?? { codec };
}

/** Reads whatever a file says about its own audio track, in the shape a sidecar's audio keys take.
 *
 * Null means *no audio track*: the file was opened and it has none, or it could not be opened at
 * all. That is what decides between BEP047's `_video` and `_audiovideo` suffixes, so an unreadable
 * container is deliberately treated as silent — naming a file `_audiovideo` on a guess would be
 * worse than under-describing one this app could not read.
 *
 * A track that *is* there but says little about itself yields a record with only the keys it did
 * answer for, empty at the limit — best effort throughout, like every other technical reading here
 * (see `AudioDetail` in lib/provenance.ts). */
export async function audioFormatInfo(blob: Blob): Promise<AudioDetail | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;
    const detail: AudioDetail = {};
    const codec = await track.getCodec().catch(() => null);
    if (codec) {
      const info = audioCodecInfo(codec);
      detail.codec = info.codec;
      if (info.bitDepth) detail.bitDepth = info.bitDepth;
    }
    // Some tracks name a codec loosely without a full parameter string being derivable from them,
    // which is a real "don't know" rather than a failure to read the file.
    const codecRFC6381 = await track.getCodecParameterString().catch(() => null);
    if (codecRFC6381) detail.codecRFC6381 = codecRFC6381;
    // Both are BEP047-constrained — a rate above zero, at least one channel — so a container that
    // reports neither (or reports nonsense) leaves them out rather than writing a value the spec
    // would reject.
    const sampleRate = await track.getSampleRate().catch(() => 0);
    if (sampleRate > 0) detail.sampleRate = sampleRate;
    const channelCount = await track.getNumberOfChannels().catch(() => 0);
    if (channelCount >= 1) detail.channelCount = channelCount;
    return detail;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
