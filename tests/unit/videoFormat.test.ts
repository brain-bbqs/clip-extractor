import { describe, expect, it } from "vitest";
import { pixelFormatInfo, videoFormatInfo } from "../../src/lib/videoFormat";

describe("videoFormatInfo", () => {
  it("claims nothing at all about bytes that are not a video, rather than throwing", async () => {
    await expect(videoFormatInfo(new Blob(["not a video"], { type: "video/mp4" }))).resolves.toEqual({});
  });
});

describe("pixelFormatInfo", () => {
  it("names an 8-bit planar YUV format after FFmpeg's own pix_fmt, with no depth suffix", () => {
    expect(pixelFormatInfo("I420")).toEqual({ pixelFormat: "yuv420p", bitDepth: 8 });
    expect(pixelFormatInfo("I444")).toEqual({ pixelFormat: "yuv444p", bitDepth: 8 });
  });

  it("names the alpha variant with FFmpeg's own yuva prefix", () => {
    expect(pixelFormatInfo("I420A")).toEqual({ pixelFormat: "yuva420p", bitDepth: 8 });
  });

  it("names a higher bit depth with FFmpeg's own p10le/p12le suffix", () => {
    expect(pixelFormatInfo("I420P10")).toEqual({ pixelFormat: "yuv420p10le", bitDepth: 10 });
    expect(pixelFormatInfo("I422P12")).toEqual({ pixelFormat: "yuv422p12le", bitDepth: 12 });
  });

  it("combines alpha and a higher bit depth", () => {
    expect(pixelFormatInfo("I444AP10")).toEqual({ pixelFormat: "yuva444p10le", bitDepth: 10 });
  });

  it("names the packed formats FFmpeg's own way, always 8-bit", () => {
    expect(pixelFormatInfo("NV12")).toEqual({ pixelFormat: "nv12", bitDepth: 8 });
    expect(pixelFormatInfo("RGBA")).toEqual({ pixelFormat: "rgba", bitDepth: 8 });
    expect(pixelFormatInfo("RGBX")).toEqual({ pixelFormat: "rgb0", bitDepth: 8 });
    expect(pixelFormatInfo("BGRA")).toEqual({ pixelFormat: "bgra", bitDepth: 8 });
    expect(pixelFormatInfo("BGRX")).toEqual({ pixelFormat: "bgr0", bitDepth: 8 });
  });
});
