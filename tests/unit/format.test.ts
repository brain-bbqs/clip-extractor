import { describe, expect, it } from "vitest";
import { bytes, fmtTime, initialsFrom, rulerLabel, rulerStep } from "../../src/lib/format";

describe("rulerStep", () => {
  it("divides a clip into gradations someone reads at a glance", () => {
    expect(rulerStep(30)).toEqual({ major: 5, minor: 1 });
    expect(rulerStep(600)).toEqual({ major: 120, minor: 24 });
  });

  it("carries an hours-long recording, rather than crowding it under a smear of ticks", () => {
    // 16.26 hours: the step is picked so the track holds a couple of dozen ticks, not hundreds.
    const { major, minor } = rulerStep(58528);
    expect(major).toBe(10800);
    expect(Math.round(58528 / minor)).toBeLessThan(40);
  });

  it("stops widening at its largest step, so a step is always returned", () => {
    expect(rulerStep(Number.MAX_SAFE_INTEGER).major).toBe(43200);
  });
});

describe("rulerLabel", () => {
  it("reads as minutes and seconds inside the hour", () => {
    expect(rulerLabel(0)).toBe("0:00");
    expect(rulerLabel(65)).toBe("1:05");
    expect(rulerLabel(599)).toBe("9:59");
  });

  it("brings out an hours field once there are hours to tell apart", () => {
    expect(rulerLabel(3600)).toBe("1:00:00");
    expect(rulerLabel(58528)).toBe("16:15:28");
  });

  it("rounds to the second, so a gradation never reads with a fraction", () => {
    expect(rulerLabel(59.7)).toBe("1:00");
  });
});

describe("fmtTime", () => {
  it("formats a frame index against the source rate", () => {
    expect(fmtTime(45, 30)).toBe("0:01.50");
    expect(fmtTime(2700, 30)).toBe("1:30.00");
  });

  it("falls back to the bare frame number without a rate to divide by", () => {
    expect(fmtTime(45, 0)).toBe("45");
  });
});

describe("bytes", () => {
  it("scales through B, KB and MB", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(2048)).toBe("2.0 KB");
    expect(bytes(5 * 1048576)).toBe("5.00 MB");
  });

  // An archived recording runs to hundreds of gigabytes, which stopping at MB rendered as six
  // figures of them.
  it("carries on into GB and TB, rather than counting a huge file in megabytes", () => {
    expect(bytes(10.6 * 1024 ** 3)).toBe("10.60 GB");
    expect(bytes(360464443754)).toBe("335.71 GB");
    expect(bytes(3 * 1024 ** 4)).toBe("3.00 TB");
  });

  it("changes unit exactly at each multiple", () => {
    expect(bytes(1023)).toBe("1023 B");
    expect(bytes(1024)).toBe("1.0 KB");
    expect(bytes(1024 ** 2 - 1)).toBe("1024.0 KB");
    expect(bytes(1024 ** 2)).toBe("1.00 MB");
    expect(bytes(1024 ** 3 - 1)).toBe("1024.00 MB");
    expect(bytes(1024 ** 3)).toBe("1.00 GB");
    expect(bytes(1024 ** 4)).toBe("1.00 TB");
  });

  it("has nothing to show for nothing", () => {
    expect(bytes(null)).toBe("—");
    expect(bytes(undefined)).toBe("—");
  });
});

describe("initialsFrom", () => {
  it("takes the first and last name's initials", () => {
    expect(initialsFrom("Ada Lovelace")).toBe("AL");
    expect(initialsFrom("Ada Byron King Lovelace")).toBe("AL");
  });

  it("gives up without both halves of a name", () => {
    expect(initialsFrom("Ada")).toBe("??");
    expect(initialsFrom("  ")).toBe("??");
  });
});
