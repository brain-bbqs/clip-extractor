/**
 * Hands a generated Blob to the browser's own download flow — the app is fully static, so an
 * object URL on a synthetic <a download> is the only "save to disk" path available to it.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can cancel the download in some browsers; a short delay is enough for
  // the click to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
