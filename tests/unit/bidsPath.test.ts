import { describe, expect, it } from "vitest";
import {
  bidsLabel,
  behAssetPath,
  behEntities,
  behFilename,
  behSidecarName,
  derivativesDirectory,
  parseSourceSubjectSession,
  recordingLabel,
  sourcedataDirectory,
  type BehEntities,
} from "../../src/lib/bidsPath";

describe("bidsLabel", () => {
  it("keeps an already-legal label untouched", () => {
    expect(bidsLabel("mice1", "x")).toBe("mice1");
  });

  it("strips everything but letters and digits", () => {
    expect(bidsLabel("mo-use_1", "x")).toBe("mouse1");
  });

  it("folds an accent into its base letter instead of dropping it entirely", () => {
    expect(bidsLabel("naïve", "x")).toBe("naive");
  });

  it("falls back when nothing legal is left", () => {
    expect(bidsLabel("___", "fallback")).toBe("fallback");
  });
});

describe("parseSourceSubjectSession", () => {
  it("reads the subject off the front of an archive path", () => {
    expect(parseSourceSubjectSession("sub-1/mice.mp4")).toEqual({ sub: "1", ses: null });
  });

  it("reads a session too, when there is one", () => {
    expect(parseSourceSubjectSession("sub-01/ses-02/beh/whatever.mp4")).toEqual({ sub: "01", ses: "02" });
  });

  it("returns both null for a path that does not start with sub-", () => {
    expect(parseSourceSubjectSession("mice.mp4")).toEqual({ sub: null, ses: null });
  });

  it("returns both null for no path at all — a local drop or an arbitrary URL", () => {
    expect(parseSourceSubjectSession(null)).toEqual({ sub: null, ses: null });
  });

  it("does not read a second path segment as a session unless it is one", () => {
    expect(parseSourceSubjectSession("sub-1/mice.mp4/extra")).toEqual({ sub: "1", ses: null });
  });
});

describe("recordingLabel", () => {
  it("is digits only, from the instant given", () => {
    expect(recordingLabel(new Date("2026-08-10T01:23:56.482Z"))).toBe("20260810012356482");
  });

  it("gives two different instants two different labels", () => {
    expect(recordingLabel(new Date("2026-08-10T01:23:56.000Z"))).not.toBe(recordingLabel(new Date("2026-08-10T01:23:57.000Z")));
  });
});

describe("behEntities", () => {
  it("takes sub/ses from the source path when it names one", () => {
    const e = behEntities(new Date("2026-08-10T01:23:56.482Z"), "sub-01/ses-02/beh/whatever.mp4");
    expect(e).toEqual({ sub: "01", ses: "02", recording: "20260810012356482" });
  });

  it("falls back to sub-unknown, with no session, for a path that names neither", () => {
    expect(behEntities(new Date("2026-08-10T01:23:56.482Z"), null)).toEqual({ sub: "unknown", ses: null, recording: "20260810012356482" });
  });
});

const beh: BehEntities = { sub: "1", ses: null, recording: "20260810012356482" };
const behWithSession: BehEntities = { sub: "1", ses: "2", recording: "20260810012356482" };

describe("sourcedataDirectory / derivativesDirectory", () => {
  it("mirror sub/ses under their own root", () => {
    expect(sourcedataDirectory(beh)).toBe("sourcedata/sub-1/beh");
    expect(derivativesDirectory(beh)).toBe("derivatives/clip-extractor/sub-1/beh");
  });

  it("include the session entity when there is one", () => {
    expect(sourcedataDirectory(behWithSession)).toBe("sourcedata/sub-1/ses-2/beh");
    expect(derivativesDirectory(behWithSession)).toBe("derivatives/clip-extractor/sub-1/ses-2/beh");
  });
});

describe("behFilename", () => {
  it("names a file with sub, recording and the suffix", () => {
    expect(behFilename(beh, { suffix: "video", ext: "mp4" })).toBe("sub-1_recording-20260810012356482_video.mp4");
  });

  it("includes ses- when there is a session", () => {
    expect(behFilename(behWithSession, { suffix: "video", ext: "mp4" })).toBe("sub-1_ses-2_recording-20260810012356482_video.mp4");
  });

  it("includes desc- between recording and the suffix, when given one", () => {
    expect(behFilename(beh, { desc: "overlay", suffix: "video", ext: "mp4" })).toBe(
      "sub-1_recording-20260810012356482_desc-overlay_video.mp4",
    );
  });
});

describe("behSidecarName", () => {
  it("mirrors behFilename with .json in place of the media extension", () => {
    expect(behSidecarName(beh, { suffix: "video" })).toBe("sub-1_recording-20260810012356482_video.json");
  });
});

describe("behAssetPath", () => {
  it("joins a directory and an already-legal file name", () => {
    expect(behAssetPath("sourcedata/sub-1/beh", "sub-1_recording-20260810012356482_video.mp4")).toBe(
      "sourcedata/sub-1/beh/sub-1_recording-20260810012356482_video.mp4",
    );
  });

  it("sanitizes a directory segment carrying spaces, dropping . and ..", () => {
    expect(behAssetPath("sourcedata/sub 1/./beh/..", "file.mp4")).toBe("sourcedata/sub+1/beh/file.mp4");
  });
});
