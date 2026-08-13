// Circular blur areas the person extracting places over anything that identifies a subject — a
// face, a badge, a whiteboard — before a selection leaves the browser. The regions are geometry
// only: this module says where they are, how strongly they blur, and how to burn them into a canvas
// (the player, the extracted frame, the pose overlay) or into ffmpeg's filter graph (the extracted
// snippet). Nothing here decides when the tool is offered; main.ts does that.

/** One blurred circle, in *source* pixels — never display pixels, so a region survives the player
 * being resized and lands on the same pixels in every file an extraction writes. */
export interface BlurRegion {
  x: number;
  y: number;
  radius: number;
}

/** Small enough to cover a single face at a distance, large enough to still be draggable. */
export const MIN_BLUR_RADIUS = 4;

/** Half the shorter side: a circle wider than that covers the whole frame, at which point the
 * selection itself is what should not be extracted. */
export function maxBlurRadius(width: number, height: number): number {
  return Math.max(MIN_BLUR_RADIUS, Math.round(Math.min(width, height) / 2));
}

/** The radius a freshly placed area starts at — a tenth of the shorter side, which is roughly a
 * head in a typical behavioral recording and is meant to be adjusted rather than accepted. */
export function defaultBlurRadius(width: number, height: number): number {
  const radius = Math.round(Math.min(width, height) * 0.1);
  return Math.max(MIN_BLUR_RADIUS, Math.min(maxBlurRadius(width, height), radius));
}

/** Blur strength for one radius. A third of the radius puts roughly three standard deviations
 * across the circle, so what was inside it is gone rather than merely softened. */
export function radiusSigma(radius: number): number {
  return Math.max(2, Math.round(radius / 3));
}

/** The strength every region is blurred at. One blurred copy of the frame serves all of them — both
 * on canvas and in the filter graph — so the strongest wins: over-blurring a smaller circle hides
 * more than asked for, which is the safe direction to err in. Zero when there is nothing to blur. */
export function blurSigma(regions: BlurRegion[]): number {
  return regions.reduce((strongest, region) => Math.max(strongest, radiusSigma(region.radius)), 0);
}

/** Holds a region inside the frame it belongs to: the radius first, then the centre, so a circle can
 * sit against an edge (a face at the edge of frame is exactly what needs covering) without any part
 * of its handle leaving the picture. */
export function clampRegion(region: BlurRegion, width: number, height: number): BlurRegion {
  const radius = Math.max(MIN_BLUR_RADIUS, Math.min(maxBlurRadius(width, height), Math.round(region.radius)));
  return {
    x: Math.max(0, Math.min(width, Math.round(region.x))),
    y: Math.max(0, Math.min(height, Math.round(region.y))),
    radius,
  };
}

/** Which region a point falls in, latest first (the one drawn on top), or -1 for none. */
export function hitRegion(regions: BlurRegion[], x: number, y: number): number {
  for (let i = regions.length - 1; i >= 0; i--) {
    if (Math.hypot(x - regions[i].x, y - regions[i].y) <= regions[i].radius) return i;
  }
  return -1;
}

/** Names what was blurred, for the provenance record and the `encoding` line beside it. */
export function blurSummary(regions: BlurRegion[]): string {
  if (!regions.length) return "";
  return `${regions.length} blurred region${regions.length === 1 ? "" : "s"}, gaussian sigma ${blurSigma(regions)}`;
}

/**
 * The tail of an ffmpeg filter chain that burns `regions` into whatever fed it, ending on
 * `[<outLabel>]`. Written as a graph rather than a linear chain because a circular blur needs the
 * frame twice: the whole frame is blurred once, and `blend` then picks the blurred pixel inside any
 * circle and the original everywhere else.
 *
 * `X`/`Y` are the coordinates of the plane being filtered, which for the chroma planes of a 4:2:0
 * frame are half-scale — hence `X/SW` and `Y/SH`, which are luma (source) coordinates on every
 * plane. Without that the colour of a face would be blurred over a circle a quarter of the size of
 * the one blurring its detail.
 */
export function blurFilterChain(regions: BlurRegion[], outLabel = "blurout"): string {
  const inside = regions
    .map((r) => `lt(hypot(X/SW-${r.x.toFixed(2)},Y/SH-${r.y.toFixed(2)}),${r.radius.toFixed(2)})`)
    // Summed rather than OR'd: ffmpeg's `if` reads any non-zero value as true, so a point inside
    // two overlapping circles counts twice and is still blurred once.
    .join("+");
  return [
    `split=2[blurbase][blursrc];`,
    `[blursrc]gblur=sigma=${blurSigma(regions)}[blurred];`,
    // The expression is single-quoted so its commas belong to `if()` rather than separating filter
    // options; ffmpeg's own filtergraph parser consumes the quotes (no shell is involved).
    `[blurbase][blurred]blend=all_expr='if(${inside},B,A)'[${outLabel}]`,
  ].join("");
}

// ------------------------------------------------------------------
// Canvas rendering
// ------------------------------------------------------------------

// Full-frame scratch canvases, reused across calls: a blur is repainted on every drag of a region
// and on every frame of an overlay render, and allocating two 1080p canvases each time is what
// turns that from a repaint into a stutter.
const scratchCanvases: HTMLCanvasElement[] = [];

function scratchCanvas(slot: number, width: number, height: number): HTMLCanvasElement {
  const canvas = (scratchCanvases[slot] ??= document.createElement("canvas"));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

/** Draws `source` into a canvas padded by `pad` on every side, with its edge row and column
 * stretched out into the padding. The blur below reaches `pad` pixels past the frame, and without
 * something there it would pull in transparent black — darkening exactly the regions placed against
 * an edge. Stretching the edge out instead matches what ffmpeg's `gblur` does at a frame boundary. */
function drawEdgeExtended(target: CanvasRenderingContext2D, source: CanvasImageSource, pad: number, width: number, height: number): void {
  target.drawImage(source, 0, 0, width, height, pad, pad, width, height);
  const right = width - 1;
  const bottom = height - 1;
  target.drawImage(source, 0, 0, 1, height, 0, pad, pad, height);
  target.drawImage(source, right, 0, 1, height, pad + width, pad, pad, height);
  target.drawImage(source, 0, 0, width, 1, pad, 0, width, pad);
  target.drawImage(source, 0, bottom, width, 1, pad, pad + height, width, pad);
  target.drawImage(source, 0, 0, 1, 1, 0, 0, pad, pad);
  target.drawImage(source, right, 0, 1, 1, pad + width, 0, pad, pad);
  target.drawImage(source, 0, bottom, 1, 1, 0, pad + height, pad, pad);
  target.drawImage(source, right, bottom, 1, 1, pad + width, pad + height, pad, pad);
}

/** A blurred copy of `source`, padded by `pad` on every side (so its frame content starts at
 * `pad, pad`). Null only when a scratch context cannot be had at all. */
function blurredCopy(
  source: CanvasImageSource,
  sigma: number,
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; pad: number } | null {
  const pad = Math.ceil(sigma * 3);
  const padded = scratchCanvas(0, width + pad * 2, height + pad * 2);
  const paddedCtx = padded.getContext("2d");
  const canvas = scratchCanvas(1, padded.width, padded.height);
  const ctx = canvas.getContext("2d");
  if (!paddedCtx || !ctx) return null;
  paddedCtx.clearRect(0, 0, padded.width, padded.height);
  drawEdgeExtended(paddedCtx, source, pad, width, height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // The browser's own gaussian blur, which is what `blur(Npx)` means and what `gblur=sigma=N` does
  // to the snippet, so the player previews the pixels the extraction will produce.
  if (typeof ctx.filter === "string") {
    ctx.filter = `blur(${sigma}px)`;
    ctx.drawImage(padded, 0, 0);
    ctx.filter = "none";
    return { canvas, pad };
  }
  // Canvas filters are missing on older Safari. Falling through to no blur at all would quietly
  // publish the faces this tool exists to remove, so shrink-and-magnify instead: a mosaic is not
  // the same picture as a gaussian blur, but it destroys the same detail.
  const factor = Math.max(2, Math.round(sigma));
  const small = scratchCanvas(2, Math.max(1, Math.ceil(padded.width / factor)), Math.max(1, Math.ceil(padded.height / factor)));
  const smallCtx = small.getContext("2d");
  if (!smallCtx) return null;
  smallCtx.clearRect(0, 0, small.width, small.height);
  smallCtx.drawImage(padded, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  return { canvas, pad };
}

/**
 * Replaces the pixels inside every region with blurred ones, in place. Call it after the frame is
 * drawn and before anything is drawn over it (a pose overlay belongs on top of the blur, not under
 * it), and on every canvas that leaves this page.
 */
export function paintBlurRegions(ctx: CanvasRenderingContext2D, regions: BlurRegion[], width: number, height: number): void {
  if (!regions.length || width <= 0 || height <= 0) return;
  const blurred = blurredCopy(ctx.canvas, blurSigma(regions), width, height);
  if (!blurred) return;
  ctx.save();
  ctx.beginPath();
  for (const region of regions) {
    // Each circle is its own subpath: without the moveTo, arc() would draw a line from wherever the
    // previous one ended, stitching the regions into one lopsided blob.
    ctx.moveTo(region.x + region.radius, region.y);
    ctx.arc(region.x, region.y, region.radius, 0, Math.PI * 2);
  }
  ctx.clip();
  ctx.drawImage(blurred.canvas, blurred.pad, blurred.pad, width, height, 0, 0, width, height);
  ctx.restore();
}
