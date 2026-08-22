import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createOrReplaceAsset, findExistingAsset, uploadAsset, uploadBlob } from "../../src/lib/upload";
import { apiFetch } from "../../src/lib/api";
import { uploadPartWithRetry } from "../../src/lib/s3";
import { ApiError } from "../../src/lib/errors";
import type { ArchiveConfig, Asset, FilePart } from "../../src/lib/types";

vi.mock("../../src/lib/api");
vi.mock("../../src/lib/s3");
// jsdom has no Blob.arrayBuffer(), which the real checksum walks the blob with; all three digests
// are covered against reference implementations in etag.test.ts.
vi.mock("../../src/lib/etag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/etag")>()),
  computeDandiEtag: vi.fn((_blob: Blob, _parts: unknown, onProgress?: (fraction: number) => void) => {
    onProgress?.(1);
    return Promise.resolve(`${"0".repeat(32)}-1`);
  }),
  computeMd5: vi.fn((_blob: Blob, onProgress?: (fraction: number) => void) => {
    onProgress?.(1);
    return Promise.resolve("1".repeat(32));
  }),
  computeSha256: vi.fn((_blob: Blob, onProgress?: (fraction: number) => void) => {
    onProgress?.(1);
    return Promise.resolve("2".repeat(64));
  }),
}));

const apiFetchMock = vi.mocked(apiFetch);
const uploadPartMock = vi.mocked(uploadPartWithRetry);

const cfg: ArchiveConfig = {
  api: "https://api-dandi.emberarchive.org/api",
  web: "https://dandi.emberarchive.org",
  accessToken: "t",
  dandisetId: "000123",
  embargoed: true,
};

const blob = new Blob([new Uint8Array(10)], { type: "video/mp4" });
const parts: FilePart[] = [{ number: 1, offset: 0, size: 10 }];
const etag = `${"0".repeat(32)}-1`;
const md5 = "1".repeat(32);

/** A working init -> complete -> validate conversation for a single-part upload. */
function mockHappyPath(): void {
  apiFetchMock.mockImplementation((_cfg, path) => {
    if (path === "/uploads/initialize/") {
      return Promise.resolve({ upload_id: "u1", parts: [{ part_number: 1, size: 10, upload_url: "https://s3.example/p1" }] });
    }
    if (path === "/uploads/u1/complete/") return Promise.resolve({ complete_url: "https://s3.example/complete", body: "<xml/>" });
    if (path === "/uploads/u1/validate/") return Promise.resolve({ blob_id: "b1" });
    if (path.startsWith("/dandisets/000123/versions/draft/assets/?")) return Promise.resolve({ results: [], next: null });
    if (path === "/dandisets/000123/versions/draft/assets/") return Promise.resolve({ asset_id: "a1", path: "p" });
    throw new Error(`unexpected apiFetch path: ${path}`);
  });
  uploadPartMock.mockImplementation((_url, part, onProgress) => {
    onProgress(part.size);
    return Promise.resolve("server-etag-1");
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("") }));
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadBlob", () => {
  it("initializes, uploads every part, completes on S3, and validates", async () => {
    mockHappyPath();
    const progress: number[] = [];

    expect(await uploadBlob(cfg, blob, etag, parts, (f) => progress.push(f))).toEqual({ blobId: "b1", reused: false });

    expect(progress.at(-1)).toBe(1);
    const completeCall = apiFetchMock.mock.calls.find(([, path]) => path === "/uploads/u1/complete/")!;
    expect(completeCall[2]).toEqual({ method: "POST", json: { parts: [{ part_number: 1, size: 10, etag: "server-etag-1" }] } });
    expect(fetch).toHaveBeenCalledWith("https://s3.example/complete", { method: "POST", body: "<xml/>" });
  });

  it("reuses the existing server-side blob when initialize answers 409", async () => {
    apiFetchMock.mockImplementation((_cfg, path) => {
      if (path === "/uploads/initialize/") return Promise.reject(new ApiError("conflict", 409));
      if (path === "/blobs/digest/") return Promise.resolve({ blob_id: "existing-blob" });
      throw new Error(`unexpected apiFetch path: ${path}`);
    });

    expect(await uploadBlob(cfg, blob, etag, parts, () => {})).toEqual({ blobId: "existing-blob", reused: true });
    expect(uploadPartMock).not.toHaveBeenCalled();
  });

  it("propagates a non-409 initialize failure untouched", async () => {
    apiFetchMock.mockRejectedValue(new ApiError("nope", 403));
    await expect(uploadBlob(cfg, blob, etag, parts, () => {})).rejects.toThrow("nope");
    expect(uploadPartMock).not.toHaveBeenCalled();
  });

  it("aborts when the server plans a different number of parts than the client", async () => {
    apiFetchMock.mockResolvedValue({
      upload_id: "u1",
      parts: [
        { part_number: 1, size: 5, upload_url: "https://s3.example/p1" },
        { part_number: 2, size: 5, upload_url: "https://s3.example/p2" },
      ],
    });
    await expect(uploadBlob(cfg, blob, etag, parts, () => {})).rejects.toThrow(/Server planned 2 parts but this client computed 1/);
  });

  it("surfaces an S3 CompleteMultipartUpload rejection even under HTTP 200", async () => {
    mockHappyPath();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<Error><Code>InvalidPart</Code></Error>") }));
    await expect(uploadBlob(cfg, blob, etag, parts, () => {})).rejects.toThrow(/S3 rejected the CompleteMultipartUpload request/);
  });
});

describe("findExistingAsset", () => {
  const asset = (path: string): Asset => ({ asset_id: `id-${path}`, path });

  it("returns the asset whose path matches exactly", async () => {
    apiFetchMock.mockResolvedValue({ results: [asset("a/other.mp4"), asset("a/clip.mp4")], next: null });

    expect(await findExistingAsset(cfg, "a/clip.mp4")).toEqual(asset("a/clip.mp4"));
    expect(apiFetchMock.mock.calls[0][1]).toContain(`path=${encodeURIComponent("a/clip.mp4")}`);
  });

  it("stops (returns null) when pagination points at a foreign host", async () => {
    apiFetchMock.mockResolvedValue({ results: [asset("a")], next: "https://evil.example.org/assets/?page=2" });

    expect(await findExistingAsset(cfg, "b")).toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when no page contains the path", async () => {
    apiFetchMock.mockResolvedValue({ results: [], next: null });
    expect(await findExistingAsset(cfg, "missing")).toBeNull();
  });
});

describe("createOrReplaceAsset", () => {
  it("PUTs to the existing asset when replacing", async () => {
    apiFetchMock.mockResolvedValue({ asset_id: "a1", path: "p" });

    await createOrReplaceAsset(cfg, "p", "blob-1", "a1", "video/mp4");

    expect(apiFetchMock).toHaveBeenCalledWith(cfg, "/dandisets/000123/versions/draft/assets/a1/", {
      method: "PUT",
      json: { blob_id: "blob-1", metadata: { path: "p", encodingFormat: "video/mp4" } },
    });
  });

  it("POSTs a new asset (without encodingFormat when unknown) when none exists", async () => {
    apiFetchMock.mockResolvedValue({ asset_id: "a2", path: "p" });

    await createOrReplaceAsset(cfg, "p", "blob-1", null);

    expect(apiFetchMock).toHaveBeenCalledWith(cfg, "/dandisets/000123/versions/draft/assets/", {
      method: "POST",
      json: { blob_id: "blob-1", metadata: { path: "p" } },
    });
  });
});

describe("uploadAsset", () => {
  it("reuses a digest the caller already computed instead of hashing again", async () => {
    mockHappyPath();
    const { computeDandiEtag } = await import("../../src/lib/etag");

    await uploadAsset(cfg, {
      blob,
      path: "sourcedata/raw/clip-extractor/stamp_snippet/clip.mp4",
      digest: { etag, md5, parts },
    });

    expect(vi.mocked(computeDandiEtag)).not.toHaveBeenCalled();
    expect(apiFetchMock.mock.calls.some(([, path]) => path === "/uploads/initialize/")).toBe(true);
  });

  it("checksums, transfers, and registers the blob at the requested path", async () => {
    mockHappyPath();
    const phases: string[] = [];

    const asset = await uploadAsset(cfg, {
      blob,
      path: "sourcedata/raw/clip-extractor/stamp/clip.mp4",
      contentType: "video/mp4",
      onPhase: (phase, fraction) => phases.push(`${phase}:${fraction}`),
    });

    expect(asset).toEqual({ asset_id: "a1", path: "p" });
    // Three full passes over the bytes — the dandi-etag, the plain MD5, then the SHA-256 — reported
    // as one smooth, ascending 0..1 rather than a bar that fills and resets twice: each pass ends a
    // third further along, the last of them at 1.
    const checksumFractions = phases.filter((p) => p.startsWith("checksum:")).map((p) => Number(p.split(":")[1]));
    expect(checksumFractions).toHaveLength(3);
    expect(checksumFractions[0]).toBeCloseTo(1 / 3);
    expect(checksumFractions[1]).toBeCloseTo(2 / 3);
    expect(checksumFractions[2]).toBe(1);
    expect(phases.at(-1)).toBe("register:1");
    const created = apiFetchMock.mock.calls.find(([, path]) => path === "/dandisets/000123/versions/draft/assets/")!;
    expect(created[2]).toEqual({
      method: "POST",
      json: { blob_id: "b1", metadata: { path: "sourcedata/raw/clip-extractor/stamp/clip.mp4", encodingFormat: "video/mp4" } },
    });
  });
});
