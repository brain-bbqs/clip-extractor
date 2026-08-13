import { describe, expect, it, vi, afterEach } from "vitest";
import { HUMAN_SUBJECTS_PHRASE, containsHumanSubjects, fetchDraftMetadata } from "../../src/lib/humanSubjects";
import type { ArchiveConfig } from "../../src/lib/types";

const cfg: ArchiveConfig = {
  api: "https://api-dandi.emberarchive.org/api",
  web: "https://dandi.emberarchive.org",
  accessToken: "token",
  dandisetId: "000123",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("containsHumanSubjects", () => {
  it("finds the marker phrase anywhere in the draft description", () => {
    expect(containsHumanSubjects({ description: `Staging dataset. ${HUMAN_SUBJECTS_PHRASE}. Ask before sharing.` })).toBe(true);
  });

  it("is case-sensitive, so an ordinary mention of human subjects is not a flag", () => {
    expect(containsHumanSubjects({ description: "Recordings of mice, not contains human subjects" })).toBe(false);
  });

  it("treats a missing description, or missing metadata, as unflagged", () => {
    expect(containsHumanSubjects({})).toBe(false);
    expect(containsHumanSubjects(null)).toBe(false);
  });
});

describe("fetchDraftMetadata", () => {
  it("reads the selected dandiset's draft version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ description: HUMAN_SUBJECTS_PHRASE }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const metadata = await fetchDraftMetadata(cfg);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api-dandi.emberarchive.org/api/dandisets/000123/versions/draft/");
    expect(containsHumanSubjects(metadata)).toBe(true);
  });
});
