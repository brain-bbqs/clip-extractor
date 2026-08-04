import type { SleapVideoBackend, VideoFrameLike } from "./types";

// Video source opening + the B-frame decode->display reorder, factored out of main.ts so both
// halves can be unit tested without a real sleap-io.js backend or DOM.

/** True iff `times` is already non-decreasing, i.e. decode order matches display order. */
function isOrdered(times: number[]): boolean {
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) return false;
  }
  return true;
}

/** Builds a display-index -> decode-index map from a backend's frame timestamps, or null when
 * decode order already matches display order (the common case) or the backend can't report
 * timestamps at all. */
export async function buildFrameOrder(backend: SleapVideoBackend): Promise<number[] | null> {
  if (typeof backend.getFrameTimes !== "function") return null;
  let times: number[] | null | undefined = null;
  try {
    times = await backend.getFrameTimes();
  } catch {
    return null;
  }
  if (!times || !times.length) return null;
  if (isOrdered(times)) return null;
  const order = Array.from({ length: times.length }, (_, i) => i);
  order.sort((a, b) => times[a] - times[b]);
  return order;
}

/** Maps a display frame index to its decode index, given the order from {@link buildFrameOrder}. */
export function decodeIndex(frameOrder: number[] | null, displayIndex: number): number {
  return frameOrder ? frameOrder[displayIndex] : displayIndex;
}

/** Draws a decoded frame (whatever shape the backend handed back) onto a 2D canvas context. */
export function drawVideoFrame(frame: VideoFrameLike, targetCtx: CanvasRenderingContext2D, w: number, h: number): void {
  if (frame instanceof ImageBitmap) {
    targetCtx.drawImage(frame, 0, 0);
    return;
  }
  if (frame instanceof ImageData) {
    targetCtx.putImageData(frame, 0, 0);
    return;
  }
  const buffer = frame instanceof ArrayBuffer ? frame : frame.buffer;
  try {
    const arr = new Uint8ClampedArray(buffer as ArrayBuffer);
    targetCtx.putImageData(new ImageData(arr, w, h), 0, 0);
  } catch {
    // Malformed/mismatched buffer size — nothing sensible to draw, leave the canvas as-is.
  }
}
