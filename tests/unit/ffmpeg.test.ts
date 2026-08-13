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
