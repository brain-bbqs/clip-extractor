// Direct browser-to-S3 part uploads against the presigned URLs the archive hands out. XHR rather
// than fetch: it is the only way to get upload progress events. Ported from
// brain-bbqs/bbqs-uploader.

function uploadPartToS3(url: string, blob: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = (xhr.getResponseHeader("ETag") || "").replace(/"/g, "");
        if (!etag) {
          reject(
            new Error(
              "S3 accepted the part but the ETag response header is not readable. " +
                "The storage bucket's CORS configuration must expose the ETag header " +
                "for browser-based uploads to work.",
            ),
          );
          return;
        }
        resolve(etag);
      } else {
        reject(new Error(`S3 part upload failed with HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during S3 part upload (possibly a CORS rejection)."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    if (signal) signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/** PUTs one part, retrying transient failures with backoff. A cancellation or a missing (CORS-
 * blocked) ETag header is final — retrying either just repeats the same outcome. */
export async function uploadPartWithRetry(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) throw new Error("Upload cancelled.");
    try {
      return await uploadPartToS3(url, blob, onProgress, signal);
    } catch (e) {
      lastErr = e;
      const message = e instanceof Error ? e.message : String(e);
      if (/cancelled/i.test(message) || /ETag response header/.test(message)) throw e;
      onProgress(0);
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw lastErr;
}
