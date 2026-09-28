// @vitest-environment jsdom
// Boots the real app under `?test&num_datasets=2&human_subjects`: it looks signed in without a
// token, offers the two fake datasets in a dropdown, and asks nothing of the archive.
import { beforeAll, describe, expect, it } from "vitest";
import { bootMain, el } from "./helpers/mainHarness";

let booted: Awaited<ReturnType<typeof bootMain>>;

beforeAll(async () => {
  booted = await bootMain("?test&num_datasets=2&human_subjects");
});

describe("main.ts boot with ?test&num_datasets=2&human_subjects", () => {
  it("renders the header signed in as the live smoketest user", () => {
    expect(el("oauthSigninBtn").hidden).toBe(true);
    expect(el("oauthSignedIn").hidden).toBe(false);
    expect(el("oauthUsername").textContent).toBe("Live Smoketest");
    expect(el("deliverToggleRow").hidden).toBe(false);
  });

  it("offers the fake datasets in a dropdown, flagged as human subjects", () => {
    const select = el<HTMLSelectElement>("dandisetId");
    expect(select.hidden).toBe(false);
    expect(el("dandisetMessage").hidden).toBe(true);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "(214000) Incoming: Test Lab 1 (human subjects)",
      "(214001) Incoming: Test Lab 2 (human subjects)",
    ]);
  });

  it("raises the human-subjects banner, awaiting confirmation, with Upload disabled", () => {
    expect(el("uploadPane").hidden).toBe(false);
    expect(el("humanSubjectsBanner").hidden).toBe(false);
    expect(el("humanSubjectsUnconfirmed").hidden).toBe(false);
    expect(el<HTMLButtonElement>("btnUpload").disabled).toBe(true);
  });

  it("asks nothing of the archive", () => {
    expect(booted.fetch?.calls).toEqual([]);
  });
});
