import type { ArchiveConfig, Asset, CompletedPart, FilePart, UploadInitResponse } from "./types";
import { apiFetch } from "./api";
import { ApiError } from "./errors";
import { computeDandiEtag, computeMd5, computeSha256, planParts } from "./etag";
import { throwIfInterrupted } from "./interrupt";
import { runQueue } from "./queue";
import { uploadPartWithRetry } from "./s3";

// The archive-side upload contract, ported from brain-bbqs/bbqs-uploader: hash the blob into the
// dandi-etag the server plans its multipart layout around, PUT each part straight to S3, let the
// API validate the result into a blob, then register that blob as an asset at a given path.

const PARALLEL_PARTS = 3;

export interface UploadBlobResult {
  blobId: string;
  /** True when the archive already held this exact content and no bytes were re-transferred. */
  reused: boolean;
}

export async function uploadBlob(
  cfg: ArchiveConfig,
  blob: Blob,
  etag: string,
  parts: FilePart[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadBlobResult> {
  // A 409 from initialize means an identical blob already exists server-side, and the catch below
  // reuses it without re-transferring any bytes. The 409 is expected and fully handled, but it
  // still shows up in the browser console: browsers log every >=400 response at the network layer
  // and pages have no way to suppress that (whatwg/fetch#1815).
  let init: UploadInitResponse;
  try {
    init = (await apiFetch<UploadInitResponse>(cfg, "/uploads/initialize/", {
      method: "POST",
      json: {
        contentSize: blob.size,
        digest: { algorithm: "dandi:dandi-etag", value: etag },
        dandiset: cfg.dandisetId,
      },
    }))!;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // The server names the existing blob in the 409's Location header, but that header is not
      // CORS-exposed to cross-origin JS, so look the blob up by digest instead.
      const existing = (await apiFetch<{ blob_id: string }>(cfg, "/blobs/digest/", {
        method: "POST",
        json: { algorithm: "dandi:dandi-etag", value: etag },
      }))!;
      onProgress(1);
      return { blobId: existing.blob_id, reused: true };
    }
    throw e;
  }

  throwIfInterrupted(signal);
  const serverParts = init.parts;
  if (serverParts.length !== parts.length) {
    throw new Error(`Server planned ${serverParts.length} parts but this client computed ${parts.length} — aborting.`);
  }

  const partBytes = new Array<number>(serverParts.length).fill(0);
  const results = new Array<CompletedPart>(serverParts.length);
  const reportProgress = () => {
    const sent = partBytes.reduce((a, b) => a + b, 0);
    onProgress(Math.min(sent / blob.size, 0.999));
  };
  await runQueue(serverParts, PARALLEL_PARTS, async (sp, i) => {
    const local = parts.at(sp.part_number - 1);
    if (!local || local.size !== sp.size) {
      throw new Error(`Part ${sp.part_number} size mismatch between client and server.`);
    }
    const serverEtag = await uploadPartWithRetry(
      sp.upload_url,
      blob.slice(local.offset, local.offset + local.size),
      (loaded) => {
        partBytes[i] = loaded;
        reportProgress();
      },
      signal,
    );
    partBytes[i] = local.size;
    reportProgress();
    results[i] = { part_number: sp.part_number, size: sp.size, etag: serverEtag };
  });

  // Finish the multipart upload on S3, then let the API validate the etag.
  throwIfInterrupted(signal);
  const completion = (await apiFetch<{ complete_url: string; body: string }>(cfg, `/uploads/${init.upload_id}/complete/`, {
    method: "POST",
    json: { parts: results },
  }))!;
  const s3Resp = await fetch(completion.complete_url, { method: "POST", body: completion.body });
  const s3Text = await s3Resp.text();
  if (!s3Resp.ok || /<Error>/.test(s3Text)) {
    throw new Error(`S3 rejected the CompleteMultipartUpload request: ${s3Text.slice(0, 300)}`);
  }

  const validated = (await apiFetch<{ blob_id: string }>(cfg, `/uploads/${init.upload_id}/validate/`, { method: "POST" }))!;
  onProgress(1);
  return { blobId: validated.blob_id, reused: false };
}

/** The draft-version asset already sitting at `path`, if any — an upload to an occupied path
 * replaces (PUT) rather than creates (POST). */
export async function findExistingAsset(cfg: ArchiveConfig, path: string): Promise<Asset | null> {
  let url: string | null =
    `/dandisets/${cfg.dandisetId}/versions/draft/assets/?path=${encodeURIComponent(path)}&metadata=false&page_size=100`;
  for (let pages = 0; url && pages < 20; pages++) {
    const page: { results?: Asset[]; next?: string | null } = (await apiFetch<{ results?: Asset[]; next?: string | null }>(cfg, url))!;
    const hit = (page.results ?? []).find((a) => a.path === path);
    if (hit) return hit;
    // Follow server pagination in case the path filter matches many assets.
    url = page.next ? page.next.replace(cfg.api, "") : null;
    if (url && /^https?:\/\//.test(url)) return null; // next page on foreign host — stop
  }
  return null;
}

export async function createOrReplaceAsset(
  cfg: ArchiveConfig,
  path: string,
  blobId: string,
  existingAssetId: string | null,
  encodingFormat?: string,
): Promise<Asset> {
  const metadata: { path: string; encodingFormat?: string } = { path };
  if (encodingFormat) metadata.encodingFormat = encodingFormat;
  const payload = { blob_id: blobId, metadata };
  if (existingAssetId) {
    return (await apiFetch<Asset>(cfg, `/dandisets/${cfg.dandisetId}/versions/draft/assets/${existingAssetId}/`, {
      method: "PUT",
      json: payload,
    }))!;
  }
  return (await apiFetch<Asset>(cfg, `/dandisets/${cfg.dandisetId}/versions/draft/assets/`, { method: "POST", json: payload }))!;
}

export type UploadPhase = "checksum" | "upload" | "register";

/** A blob's dandi-etag and plain MD5, together with the part layout the etag was computed over.
 * Worth keeping around: the same digests identify the blob to the archive and are what the
 * provenance record and a sidecar's own `Checksum` field report, so a file is never hashed twice. */
export interface BlobDigest {
  etag: string;
  md5: string;
  sha256: string;
  parts: FilePart[];
}

export async function checksumBlob(blob: Blob, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<BlobDigest> {
  const parts = planParts(blob.size);
  // Three full passes over the bytes — the dandi-etag, the plain MD5 and the SHA-256 are all
  // different digests (see lib/etag.ts's computeMd5) — reported as one smooth 0..1 rather than a bar
  // that fills and resets twice.
  const etag = await computeDandiEtag(blob, parts, (f) => onProgress?.(f / 3), signal);
  const md5 = await computeMd5(blob, (f) => onProgress?.((1 + f) / 3), signal);
  const sha256 = await computeSha256(blob, (f) => onProgress?.((2 + f) / 3), signal);
  return { etag, md5, sha256, parts };
}

export interface UploadAssetParams {
  blob: Blob;
  /** Full asset path within the dandiset's draft version. */
  path: string;
  contentType?: string;
  /** A digest from an earlier {@link checksumBlob} call; computed here when omitted. */
  digest?: BlobDigest;
  /** Called with the current phase and its own 0..1 progress. */
  onPhase?: (phase: UploadPhase, fraction: number) => void;
  signal?: AbortSignal;
}

/** Checksums, uploads, and registers one blob as an asset at `path`. */
export async function uploadAsset(cfg: ArchiveConfig, params: UploadAssetParams): Promise<Asset> {
  const { blob, path, contentType, onPhase, signal } = params;
  const { etag, parts } = params.digest ?? (await checksumBlob(blob, (f) => onPhase?.("checksum", f), signal));
  // A path match says nothing about content, so it never skips the upload; it only decides whether
  // asset registration replaces or creates. Content dedup stays server-side (uploadBlob's 409).
  throwIfInterrupted(signal);
  const existing = await findExistingAsset(cfg, path);
  const { blobId } = await uploadBlob(cfg, blob, etag, parts, (f) => onPhase?.("upload", f), signal);
  // Checked before registration rather than after: the bytes are in the archive either way once the
  // blob validates, and an asset nothing points at is the tidier thing to leave behind.
  throwIfInterrupted(signal);
  onPhase?.("register", 0);
  const asset = await createOrReplaceAsset(cfg, path, blobId, existing?.asset_id ?? null, contentType);
  onPhase?.("register", 1);
  return asset;
}
