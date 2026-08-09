import { afterEach, describe, expect, it, vi } from "vitest";
import { listIncomingDandisets } from "../../src/lib/dandisets";
import type { ArchiveConfig } from "../../src/lib/types";

const cfg: ArchiveConfig = {
  api: "https://api.example.org/api",
  web: "https://example.org",
  accessToken: "tok",
  dandisetId: "",
};

interface FakeDandiset {
  identifier: string;
  title: string;
  embargoed?: boolean;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Stubs both calls listIncomingDandisets makes: the archive listing and the admin-check service. */
function stubArchive(dandisets: FakeDandiset[], adminOwned: (identifier: string) => boolean | "error"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = String(input);
      if (url.includes("/admin-owned/")) {
        const identifier = url.split("/admin-owned/")[1];
        const owned = adminOwned(identifier);
        if (owned === "error") return Promise.resolve(jsonResponse({}, false, 500));
        return Promise.resolve(jsonResponse({ adminOwned: owned }));
      }
      return Promise.resolve(
        jsonResponse({
          results: dandisets.map((d) => ({
            identifier: d.identifier,
            embargo_status: d.embargoed === false ? "OPEN" : "EMBARGOED",
            draft_version: { name: d.title },
          })),
        }),
      );
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listIncomingDandisets", () => {
  it("keeps only admin-owned datasets titled 'Incoming: …'", async () => {
    stubArchive(
      [
        { identifier: "000001", title: "Incoming: Lab A" },
        { identifier: "000002", title: "Some other dataset" },
      ],
      () => true,
    );
    const { datasets } = await listIncomingDandisets(cfg);
    expect(datasets.map((d) => d.identifier)).toEqual(["000001"]);
  });

  it("drops an 'Incoming: ' dataset no admin owns, so it can't be self-provisioned", async () => {
    stubArchive(
      [
        { identifier: "000001", title: "Incoming: Admin backed" },
        { identifier: "000002", title: "Incoming: Self provisioned" },
      ],
      (identifier) => identifier === "000001",
    );
    const { datasets, unverified } = await listIncomingDandisets(cfg);
    expect(datasets.map((d) => d.identifier)).toEqual(["000001"]);
    // A completed "no" is not an outage — nothing to warn the user about.
    expect(unverified).toBe(0);
  });

  it("fails closed when the admin check itself errors, and reports it as unverified", async () => {
    stubArchive([{ identifier: "000001", title: "Incoming: Lab A" }], () => "error");
    const { datasets, unverified } = await listIncomingDandisets(cfg);
    expect(datasets).toEqual([]);
    expect(unverified).toBe(1);
  });

  it("separates a verified dataset from one whose check could not complete", async () => {
    stubArchive(
      [
        { identifier: "000001", title: "Incoming: Reachable" },
        { identifier: "000002", title: "Incoming: Service down" },
      ],
      (identifier) => (identifier === "000001" ? true : "error"),
    );
    const { datasets, unverified } = await listIncomingDandisets(cfg);
    expect(datasets.map((d) => d.identifier)).toEqual(["000001"]);
    expect(unverified).toBe(1);
  });

  it("sorts by title and reports the embargo status", async () => {
    stubArchive(
      [
        { identifier: "000002", title: "Incoming: Zebra lab" },
        { identifier: "000001", title: "Incoming: Ant lab", embargoed: false },
      ],
      () => true,
    );
    const { datasets } = await listIncomingDandisets(cfg);
    expect(datasets.map((d) => d.title)).toEqual(["Incoming: Ant lab", "Incoming: Zebra lab"]);
    expect(datasets[0].embargoed).toBe(false);
    expect(datasets[1].embargoed).toBe(true);
  });
});
