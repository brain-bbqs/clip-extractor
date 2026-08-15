import { describe, expect, it } from "vitest";
import { encodedFraction, ffmpegArgs } from "../../src/lib/ffmpeg";

describe("ffmpegArgs", () => {
  it("builds a frame-exact trim filter in precise mode", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise");
    expect(args).toContain("-vf");
    expect(args).toContain("trim=start_frame=10:end_frame=41,setpts=PTS-STARTPTS");
    expect(args).toContain("libx264");
    expect(args[args.length - 1]).toBe("clip.mp4");
  });

  it("builds a keyframe-aligned stream copy in fast mode", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast");
    expect(args).toEqual([
      "-ss",
      "1.0000",
      "-i",
      "in.mp4",
      "-t",
      "2.0000",
      "-c",
      "copy",
      "-an",
      "-avoid_negative_ts",
      "make_zero",
      "clip.mp4",
    ]);
  });

  it("drops audio on every route out, a stream copy included", () => {
    const blur = [{ x: 10, y: 10, radius: 20 }];
    // `-c copy` would otherwise carry the source's audio straight through, which is the one route
    // that ever did.
    expect(ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast")).toContain("-an");
    expect(ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise")).toContain("-an");
    expect(ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast", blur)).toContain("-an");
    expect(ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise", blur)).toContain("-an");
  });

  it("trims and blurs in one graph, mapping the label the blur ends on", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 10, 40, 30, "precise", [{ x: 320, y: 240, radius: 60 }]);
    expect(args).not.toContain("-vf");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph.startsWith("[0:v]trim=start_frame=10:end_frame=41,setpts=PTS-STARTPTS,split=2")).toBe(true);
    expect(graph.endsWith("[blurout]")).toBe(true);
    expect(args[args.indexOf("-map") + 1]).toBe("[blurout]");
    expect(args).toContain("libx264");
  });

  it("re-encodes even in fast mode once anything is blurred, since a stream copy cannot burn one in", () => {
    const args = ffmpegArgs("in.mp4", "clip.mp4", 30, 89, 30, "fast", [{ x: 10, y: 10, radius: 20 }]);
    expect(args).not.toContain("copy");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("libx264");
  });
});

describe("encodedFraction", () => {
  // The numbers here are what ffmpeg.wasm reported while cutting a three-second snippet out of a
  // sixty-second recording: its own `progress` never passes 0.05, since that is all of the source
  // the snippet covers.
  it("measures the clip being written rather than the source it came out of", () => {
    expect(encodedFraction({ progress: 0.0242, time: 1450000 }, 3)).toBeCloseTo(0.4833, 4);
    expect(encodedFraction({ progress: 0.0483, time: 2900065 }, 3)).toBeCloseTo(0.9667, 4);
  });

  it("has nothing to report until the first frame is muxed", () => {
    // AV_NOPTS_VALUE, which arrives while ffmpeg is still decoding its way up to the selection.
    expect(encodedFraction({ progress: 153722867280.9, time: 9223372036854776000 }, 3)).toBe(null);
    expect(encodedFraction({ progress: 0, time: Number.NaN }, 3)).toBe(null);
    expect(encodedFraction({ progress: 0, time: -1000 }, 3)).toBe(null);
  });

  it("refuses to divide by a selection with no duration", () => {
    expect(encodedFraction({ progress: 0.5, time: 1000 }, 0)).toBe(null);
    expect(encodedFraction({ progress: 0.5, time: 1000 }, Number.NaN)).toBe(null);
  });

  it("holds at full rather than overshooting it", () => {
    expect(encodedFraction({ progress: 1, time: 3100000 }, 3)).toBe(1);
  });
});
