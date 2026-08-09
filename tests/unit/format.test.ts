import { describe, expect, it } from "vitest";
import { bytes, fmtTime, initialsFrom } from "../../src/lib/format";

describe("fmtTime", () => {
  it("formats frame 0 at 30fps as 0:00.00", () => {
    expect(fmtTime(0, 30)).toBe("0:00.00");
  });

  it("formats minutes and seconds", () => {
    expect(fmtTime(30 * 90, 30)).toBe("1:30.00");
  });

  it("falls back to the bare frame number when fps is 0", () => {
    expect(fmtTime(42, 0)).toBe("42");
  });
});

describe("initialsFrom", () => {
  it("takes the first and last name initials", () => {
    expect(initialsFrom("ada lovelace")).toBe("AL");
    expect(initialsFrom("Grace Brewster Murray Hopper")).toBe("GH");
  });

  it("falls back to ?? without both a first and a last name", () => {
    expect(initialsFrom("")).toBe("??");
    expect(initialsFrom("Prince")).toBe("??");
  });
});

describe("bytes", () => {
  it("renders null/undefined as an em dash", () => {
    expect(bytes(null)).toBe("—");
    expect(bytes(undefined)).toBe("—");
  });

  it("renders sub-KB sizes in bytes", () => {
    expect(bytes(512)).toBe("512 B");
  });

  it("renders sub-MB sizes in KB", () => {
    expect(bytes(2048)).toBe("2.0 KB");
  });

  it("renders large sizes in MB", () => {
    expect(bytes(5 * 1048576)).toBe("5.00 MB");
  });
});
