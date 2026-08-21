import { describe, expect, it } from "vitest";
import {
  bidsLabel,
  behAssetPath,
  behEntities,
  behFilename,
  behSidecarName,
  bundleFilename,
  dateLabel,
  derivativesDirectory,
  parseSourceSubjectSession,
  recordingLabel,
  sourcedataDirectory,
  sourcedataOriginalFilename,
  timeLabel,
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

describe("recordingLabel / dateLabel / timeLabel", () => {
  it("is digits only, from the instant given", () => {
    expect(recordingLabel(new Date("2026-08-10T01:23:56.482Z"))).toBe("20260810012356482");
  });

  it("gives two different instants two different recording labels", () => {
    expect(recordingLabel(new Date("2026-08-10T01:23:56.000Z"))).not.toBe(recordingLabel(new Date("2026-08-10T01:23:57.000Z")));
  });

  it("splits the same instant into a date and a time label", () => {
    expect(dateLabel(new Date("2026-08-10T01:23:56.482Z"))).toBe("20260810");
    expect(timeLabel(new Date("2026-08-10T01:23:56.482Z"))).toBe("012356");
  });
});

describe("behEntities", () => {
  it("takes sub/ses from the source path when it names one, and marks the subject known", () => {
    const e = behEntities(new Date("2026-08-10T01:23:56.482Z"), "sub-01/ses-02/beh/whatever.mp4");
    expect(e).toEqual({
      sub: "01",
      ses: "02",
      known: true,
      recording: "20260810012356482",
      date: "20260810",
      time: "012356",
    });
  });

  it("falls back to sub-unknown, with no session and known false, for a path that names neither", () => {
    expect(behEntities(new Date("2026-08-10T01:23:56.482Z"), null)).toEqual({
      sub: "unknown",
      ses: null,
      known: false,
      recording: "20260810012356482",
      date: "20260810",
      time: "012356",
    });
  });
});

const unknownBeh: BehEntities = {
  sub: "unknown",
  ses: null,
  known: false,
  recording: "20260810012356482",
  date: "20260810",
  time: "012356",
};
const knownBeh: BehEntities = { sub: "1", ses: null, known: true, recording: "20260810012356482", date: "20260810", time: "012356" };
const knownBehWithSession: BehEntities = { ...knownBeh, ses: "2" };

describe("sourcedataDirectory / derivativesDirectory", () => {
  it("mirror sub/ses under their own root — sourcedata under its rawbids subtree, derivatives with its own per-delivery subdirectory", () => {
    expect(sourcedataDirectory(knownBeh)).toBe("sourcedata/rawbids/sub-1/beh");
    expect(derivativesDirectory(knownBeh)).toBe("derivatives/clip-extractor/sub-1/beh/date-20260810_time-012356");
  });

  it("include the session entity when there is one", () => {
    expect(sourcedataDirectory(knownBehWithSession)).toBe("sourcedata/rawbids/sub-1/ses-2/beh");
    expect(derivativesDirectory(knownBehWithSession)).toBe("derivatives/clip-extractor/sub-1/ses-2/beh/date-20260810_time-012356");
  });

  it("uses recording- instead, for an unknown (sub-unknown) subject", () => {
    expect(derivativesDirectory(unknownBeh)).toBe("derivatives/clip-extractor/sub-unknown/beh/recording-20260810012356482");
  });
});

describe("sourcedataOriginalFilename", () => {
  it("names it entity-shaped, with no disambiguator — a known subject/session's copy overwrites, not duplicates", () => {
    expect(sourcedataOriginalFilename(knownBeh, "mice.mp4")).toBe("sub-1_video.mp4");
    expect(sourcedataOriginalFilename(knownBehWithSession, "mice.mp4")).toBe("sub-1_ses-2_video.mp4");
  });

  it("keeps sub-unknown undisambiguated too — nothing else tells apart two locally dropped files", () => {
    expect(sourcedataOriginalFilename(unknownBeh, "mice.mp4")).toBe("sub-unknown_video.mp4");
  });

  it("keeps the original file's own extension, lowercased", () => {
    expect(sourcedataOriginalFilename(knownBeh, "mice.WEBM")).toBe("sub-1_video.webm");
  });

  it("falls back to mp4 when the original name carries no extension", () => {
    expect(sourcedataOriginalFilename(knownBeh, "mice")).toBe("sub-1_video.mp4");
  });
});

describe("behFilename", () => {
  // The same disambiguator the enclosing directory carries (see derivativesDirectory above) is
  // repeated here, so a file stays self-describing once it is away from that directory.
  it("uses recording- to disambiguate an unknown (sub-unknown) subject", () => {
    expect(behFilename(unknownBeh, { suffix: "video", ext: "mp4" })).toBe("sub-unknown_recording-20260810012356482_video.mp4");
  });

  it("uses date-/time- instead, for a known subject", () => {
    expect(behFilename(knownBeh, { suffix: "video", ext: "mp4" })).toBe("sub-1_date-20260810_time-012356_video.mp4");
  });

  it("includes ses- when there is a session", () => {
    expect(behFilename(knownBehWithSession, { suffix: "video", ext: "mp4" })).toBe("sub-1_ses-2_date-20260810_time-012356_video.mp4");
  });

  it("includes desc- between the disambiguator and the suffix, when given one", () => {
    expect(behFilename(knownBeh, { desc: "overlay", suffix: "video", ext: "mp4" })).toBe(
      "sub-1_date-20260810_time-012356_desc-overlay_video.mp4",
    );
  });
});

describe("bundleFilename", () => {
  // Neither the disambiguator nor a suffix: the bundle is the outer container, not a file in the
  // tree it holds, so the same source saved twice lands on the same name.
  it("names the container after its subject and desc- alone", () => {
    expect(bundleFilename(unknownBeh, { desc: "extracted+clip", ext: "tar.gz" })).toBe("sub-unknown_desc-extracted+clip.tar.gz");
  });

  it("includes ses- when there is a session, and still no date-/time-", () => {
    expect(bundleFilename(knownBehWithSession, { desc: "extracted+clip", ext: "tar.gz" })).toBe("sub-1_ses-2_desc-extracted+clip.tar.gz");
  });
});

describe("behSidecarName", () => {
  it("mirrors behFilename with .json in place of the media extension", () => {
    expect(behSidecarName(knownBeh, { suffix: "video" })).toBe("sub-1_date-20260810_time-012356_video.json");
  });
});

describe("behAssetPath", () => {
  it("joins a directory and an already-legal file name", () => {
    expect(behAssetPath("sourcedata/sub-1/beh", "sub-1_date-20260810_time-012356_video.mp4")).toBe(
      "sourcedata/sub-1/beh/sub-1_date-20260810_time-012356_video.mp4",
    );
  });

  it("sanitizes a directory segment carrying spaces, dropping . and ..", () => {
    expect(behAssetPath("sourcedata/sub 1/./beh/..", "file.mp4")).toBe("sourcedata/sub+1/beh/file.mp4");
  });
});
