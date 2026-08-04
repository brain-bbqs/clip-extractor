import { describe, expect, it } from "vitest";
import { ffmpegArgs } from "../../src/lib/ffmpeg";

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
    expect(args).toEqual(["-ss", "1.0000", "-i", "in.mp4", "-t", "2.0000", "-c", "copy", "-avoid_negative_ts", "make_zero", "clip.mp4"]);
  });
});
