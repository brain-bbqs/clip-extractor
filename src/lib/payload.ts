import type { AnnotationsDocument, Extracted, PayloadMetadata } from "./types";

/** Reads a Blob to a base64 string (no `data:...;base64,` prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // readAsDataURL always resolves a string (never the ArrayBuffer overload of FileReader.result).
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = () => reject(r.error ?? new Error("Failed to read blob"));
    r.readAsDataURL(blob);
  });
}

export interface PozuPayload {
  type: "pozu";
  body: string;
  obj: { mp4: string; filename?: string; author?: string; timestamp: string };
  meta: PayloadMetadata;
  ann: AnnotationsDocument;
  contentType: "application/json";
}

export interface MultipartPayload {
  type: "multipart";
  body: FormData;
  meta: PayloadMetadata;
  ann: AnnotationsDocument;
  contentType: null;
}

export interface JsonMediaClip {
  kind: "clip";
  mime: string;
  filename: string;
  data_base64: string;
}

export interface JsonMediaFrames {
  kind: "frames";
  mime: string;
  ext: string;
  frames: { source_frame: number; clip_frame: number; data_base64: string }[];
}

export interface JsonPayload {
  type: "json";
  body: string;
  obj: { metadata: PayloadMetadata; annotations: AnnotationsDocument; media: JsonMediaClip | JsonMediaFrames };
  meta: PayloadMetadata;
  ann: AnnotationsDocument;
  contentType: "application/json";
}

export type Payload = PozuPayload | MultipartPayload | JsonPayload;

export interface BuildPayloadParams {
  extracted: Extracted;
  pkg: "pozu" | "multipart" | "json";
  meta: PayloadMetadata;
  annotations: AnnotationsDocument;
  filename: string;
  author: string;
}

/** Assembles the request payload for the currently selected packaging (Pozu `/clips`, generic
 * multipart, or generic JSON+base64). Throws if extraction hasn't run yet, or (Pozu) if the
 * extracted output isn't a single MP4 clip. */
export async function buildPayload(params: BuildPayloadParams): Promise<Payload> {
  const { extracted, pkg, meta, annotations, filename, author } = params;

  if (pkg === "pozu") {
    // Pozu /clips contract (pozu-project/pozu-backend PR #28): { mp4: base64, filename?, author?,
    // timestamp? }. The endpoint accepts a single MP4 only — no frames, no annotations.
    if (extracted.kind !== "clip") {
      throw new Error('The Pozu /clips endpoint accepts a single MP4 clip only — set Extract output to "MP4 clip".');
    }
    const obj: PozuPayload["obj"] = {
      mp4: await blobToBase64(extracted.blob),
      filename: filename || extracted.name,
      timestamp: new Date().toISOString(),
    };
    if (author) obj.author = author;
    return { type: "pozu", body: JSON.stringify(obj), obj, meta, ann: annotations, contentType: "application/json" };
  }

  if (pkg === "multipart") {
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
    fd.append("annotations", new Blob([JSON.stringify(annotations)], { type: "application/json" }), "annotations.json");
    if (extracted.kind === "clip") {
      fd.append("clip", extracted.blob, extracted.name);
    } else {
      for (const f of extracted.frames) {
        fd.append("frames", f.blob, `frame_${String(f.source_frame).padStart(6, "0")}.${extracted.ext}`);
      }
    }
    return { type: "multipart", body: fd, meta, ann: annotations, contentType: null };
  }

  const media: JsonMediaClip | JsonMediaFrames =
    extracted.kind === "clip"
      ? { kind: "clip", mime: extracted.mime, filename: extracted.name, data_base64: await blobToBase64(extracted.blob) }
      : {
          kind: "frames",
          mime: extracted.mime,
          ext: extracted.ext,
          frames: await Promise.all(
            extracted.frames.map(async (f) => ({
              source_frame: f.source_frame,
              clip_frame: f.clip_frame,
              data_base64: await blobToBase64(f.blob),
            })),
          ),
        };
  const obj = { metadata: meta, annotations, media };
  return { type: "json", body: JSON.stringify(obj), obj, meta, ann: annotations, contentType: "application/json" };
}

/** Parses the free-text "extra headers" field; throws a friendly error on invalid JSON. */
export function parseHeaders(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, string>;
  } catch {
    throw new Error("Headers must be valid JSON");
  }
}

/** Resolves the effective POST target: the raw endpoint, optionally routed through the nocors
 * proxy (needed cross-origin from `*.tlab.sh`). Returns null when no endpoint is set (dry-run). */
export function targetUrl(endpoint: string, useProxy: boolean, proxyBase: string): string | null {
  const raw = endpoint.trim();
  if (!raw) return null;
  return useProxy ? proxyBase + raw : raw;
}
