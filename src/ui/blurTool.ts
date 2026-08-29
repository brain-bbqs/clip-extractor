import type { ClipExtractorElements } from "./elements";
import { clampRegion, defaultBlurRadius, frameFit, maxBlurRadius, MIN_BLUR_RADIUS, type BlurRegion } from "../lib/blur";

// Circular areas placed over anything that identifies a subject. The blurred pixels themselves are
// painted into the player's canvas by main.ts's renderFrame and into every file by lib/extract.ts;
// everything here is the rings over the top of the picture, the controls beside it, and the
// bookkeeping that keeps the two in step. Whether the tool is offered at all is the host's to say —
// the human-subjects gate decides it — as is what to do once the areas change, since a moved ring
// changes every pixel an extraction would write.

/** What the tool needs from the page around it. The regions themselves stay in the host's own state
 * rather than being held here: they are read by the player as it draws, by the delivery card as it
 * decides whether the original may ride along, and by every extraction, so this mutates the one
 * array all of those already see. */
export interface BlurToolHost {
  /** The areas, in source-video pixels. Mutated in place by everything below. */
  regions: () => BlurRegion[];
  /** Replaces the areas outright — the one change `regions()` cannot express. */
  setRegions: (regions: BlurRegion[]) => void;
  /** The frame the areas are placed on, and whether there is one at all. */
  frame: () => { loaded: boolean; width: number; height: number };
  /** True while a delivery is running, which holds every control still: an extraction reads the
   * areas as it goes. */
  busy: () => boolean;
  /** Whether the tool belongs on screen at all, apart from the areas already placed. */
  offered: () => boolean;
  /** Called first whenever the areas change: what the host has to retire before anything is
   * redrawn (the extraction cache, the delivery card's outcome line). */
  markChanged: () => void;
  /** Redraws the picture, the blurred pixels included. */
  renderFrame: () => void;
  /** Re-derives the delivery card, whose "include the original" switch follows the areas. */
  updateDeliveryGate: () => void;
}

export interface BlurTool {
  /** Drops every area — because Clear all was pressed, or because a different video is now under
   * them and their coordinates no longer point at anything anybody has looked at. */
  clearRegions: () => void;
  /** Sizes the controls to the video just loaded. */
  resetRadius: () => void;
  /** Re-derives the controls and the rings from the areas and the host's current state. */
  render: () => void;
}

/**
 * Wires the blur tool into `els` and returns the handful of things the host drives it by. Called
 * once at boot; every listener below lives for the life of the page, and the tool answers for an
 * unloaded video by disabling itself rather than by being torn down.
 */
export function createBlurTool(els: ClipExtractorElements, host: BlurToolHost): BlurTool {
  // Whether the next click on the picture places a new area, rather than landing on it and doing
  // nothing.
  let blurArmed = false;
  // Which area the radius control and Remove act on: an index into the areas, or null for none.
  // Focus and selection are the same thing, so tabbing between rings moves the controls with it.
  let selectedBlur: number | null = null;
  // The radius a newly placed area starts at, carried between placements so covering four faces at
  // one size is four clicks rather than four resizes.
  let newBlurRadius = MIN_BLUR_RADIUS;
  // The area being dragged, with the grab point's offset from its centre, so a ring picked up by its
  // edge does not jump its centre under the pointer.
  let blurDrag: { index: number; dx: number; dy: number } | null = null;

  /** The area at `index`, or null when the index no longer points at one: a ring reads its index
   * back out of the DOM, and the area behind it may have been removed since the event was bound. */
  function blurRegionAt(index: number | null): BlurRegion | null {
    const regions = host.regions();
    if (index === null || index < 0 || index >= regions.length) return null;
    return regions[index];
  }

  /** How large an area is allowed to be, which only means anything once a video is loaded — the
   * bounds are the frame. The fallback matches the markup's own, for the disabled controls. */
  function blurRadiusBounds(): { min: number; max: number } {
    const { loaded, width, height } = host.frame();
    return { min: MIN_BLUR_RADIUS, max: loaded ? maxBlurRadius(width, height) : 100 };
  }

  /** Where a pointer is in source-video pixels. The canvas is drawn at whatever size the layout
   * gives it, and letterboxed inside that box when the two are different shapes, so every screen
   * coordinate the tool reads comes through the same fit the rings are placed by. */
  function sourcePoint(clientX: number, clientY: number): { x: number; y: number } {
    const { width, height } = host.frame();
    const rect = els.view.getBoundingClientRect();
    const fit = frameFit(rect.width, rect.height, width, height);
    if (!fit.scale) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - fit.offsetX) / fit.scale, y: (clientY - rect.top - fit.offsetY) / fit.scale };
  }

  function resetBlurRadius(): void {
    const { width, height } = host.frame();
    newBlurRadius = defaultBlurRadius(width, height);
    renderBlurTools();
  }

  /** Every mutation of the areas funnels through here: the pixels change, so the picture is
   * redrawn, anything already extracted stops describing what is on screen, and the rings follow. */
  function blurChanged(): void {
    host.markChanged();
    host.renderFrame();
    renderBlurTools();
    host.updateDeliveryGate();
  }

  function clearBlurRegions(): void {
    setBlurArmed(false);
    if (!host.regions().length) return;
    host.setRegions([]);
    selectedBlur = null;
    blurChanged();
  }

  function setBlurArmed(armed: boolean): void {
    blurArmed = armed && host.frame().loaded && !host.busy();
    els.stage.classList.toggle("placing", blurArmed);
    els.blurAddBtn.classList.toggle("armed", blurArmed);
    els.blurAddBtn.setAttribute("aria-pressed", String(blurArmed));
    renderBlurHint();
  }

  function addBlurRegion(x: number, y: number): void {
    const { loaded, width, height } = host.frame();
    if (!loaded) return;
    const regions = host.regions();
    regions.push(clampRegion({ x, y, radius: newBlurRadius }, width, height));
    selectedBlur = regions.length - 1;
    setBlurArmed(false);
    blurChanged();
    // Focus follows the new ring, so it can be nudged into place from the keyboard straight away.
    (els.blurLayer.children[selectedBlur] as HTMLElement | undefined)?.focus();
  }

  function removeBlurRegion(index: number): void {
    if (!blurRegionAt(index)) return;
    const regions = host.regions();
    regions.splice(index, 1);
    selectedBlur = regions.length ? Math.min(index, regions.length - 1) : null;
    blurChanged();
    // The ring that had focus is gone; hand it to its neighbour, or back to the button that makes
    // new ones, rather than letting it fall to the top of the document.
    const next = selectedBlur === null ? els.blurAddBtn : (els.blurLayer.children[selectedBlur] as HTMLElement);
    next.focus();
  }

  /** Applies a radius to the selected area, and to the next one placed. */
  function setBlurRadius(radius: number): void {
    const { width, height } = host.frame();
    const { min, max } = blurRadiusBounds();
    newBlurRadius = Math.max(min, Math.min(max, Math.round(radius)));
    const selected = blurRegionAt(selectedBlur);
    if (selectedBlur === null || !selected) {
      renderBlurTools();
      return;
    }
    host.regions()[selectedBlur] = clampRegion({ ...selected, radius: newBlurRadius }, width, height);
    blurChanged();
  }

  function moveBlurRegion(index: number, x: number, y: number): void {
    const region = blurRegionAt(index);
    if (!region) return;
    const { width, height } = host.frame();
    const next = clampRegion({ ...region, x, y }, width, height);
    if (next.x === region.x && next.y === region.y) return;
    host.regions()[index] = next;
    blurChanged();
  }

  /** True while the tool belongs on screen: the destination is a dataset flagged as holding
   * human-subjects data, or an area placed while it was is still there to be found and removed. */
  function blurToolAvailable(): boolean {
    return host.frame().loaded && (host.offered() || host.regions().length > 0);
  }

  function renderBlurHint(): void {
    const count = host.regions().length;
    els.blurHint.textContent = blurArmed
      ? "Click the picture to place a blur area there."
      : count === 0
        ? "Add a blur area and drag it over a face, a badge, or anything else identifying. Whatever it covers is blurred in every file this page produces."
        : `${count} blur area${count === 1 ? "" : "s"} — drag to move, arrow keys to nudge, + and − to resize. The blur is burned into the snippet, the frame and the pose overlay alike.`;
  }

  function renderBlurTools(): void {
    const available = blurToolAvailable();
    const busy = host.busy();
    els.blurTools.hidden = !available;
    if (!available) setBlurArmed(false);
    const { min, max } = blurRadiusBounds();
    const radius = blurRegionAt(selectedBlur)?.radius ?? newBlurRadius;
    for (const input of [els.blurRadiusRange, els.blurRadiusValue]) {
      input.min = String(min);
      input.max = String(max);
      input.disabled = busy;
      // Never while it is the field being dragged or typed into: rewriting a half-entered number
      // mid-keystroke makes it unusable, and the value is written back on commit anyway.
      if (document.activeElement !== input) input.value = String(radius);
    }
    els.blurAddBtn.disabled = !host.frame().loaded || busy;
    els.blurRemoveBtn.disabled = selectedBlur === null || busy;
    els.blurClearBtn.disabled = host.regions().length === 0 || busy;
    // An extraction reads the areas as it runs, so they are held still until it is done.
    els.blurLayer.classList.toggle("locked", busy);
    syncBlurHandles();
    renderBlurHint();
  }

  /** Which area a ring stands for. Read from the DOM rather than closed over, so removing an area
   * does not leave every later ring pointing one past itself. */
  function blurHandleIndex(handle: HTMLElement): number {
    return Array.prototype.indexOf.call(els.blurLayer.children, handle);
  }

  function createBlurHandle(): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "blur-handle";
    handle.tabIndex = 0;
    handle.setAttribute("role", "button");
    handle.addEventListener("focus", () => {
      selectedBlur = blurHandleIndex(handle);
      renderBlurTools();
    });
    handle.addEventListener("pointerdown", (e) => {
      const index = blurHandleIndex(handle);
      const region = blurRegionAt(index);
      if (!region || host.busy()) return;
      e.preventDefault();
      // Without this an armed click would also land on the picture and place a second area under
      // the one being grabbed.
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      handle.focus();
      const at = sourcePoint(e.clientX, e.clientY);
      blurDrag = { index, dx: region.x - at.x, dy: region.y - at.y };
    });
    handle.addEventListener("pointermove", (e) => {
      if (!blurDrag || !handle.hasPointerCapture(e.pointerId)) return;
      const at = sourcePoint(e.clientX, e.clientY);
      moveBlurRegion(blurDrag.index, at.x + blurDrag.dx, at.y + blurDrag.dy);
    });
    const release = (e: PointerEvent): void => {
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      handle.classList.remove("dragging");
      blurDrag = null;
    };
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", release);
    handle.addEventListener("keydown", (e) => {
      const index = blurHandleIndex(handle);
      const region = blurRegionAt(index);
      if (!region || host.busy()) return;
      const step = e.shiftKey ? 10 : 2;
      if (e.key === "ArrowLeft") moveBlurRegion(index, region.x - step, region.y);
      else if (e.key === "ArrowRight") moveBlurRegion(index, region.x + step, region.y);
      else if (e.key === "ArrowUp") moveBlurRegion(index, region.x, region.y - step);
      else if (e.key === "ArrowDown") moveBlurRegion(index, region.x, region.y + step);
      else if (e.key === "+" || e.key === "=") setBlurRadius(region.radius + step);
      else if (e.key === "-" || e.key === "_") setBlurRadius(region.radius - step);
      else if (e.key === "Delete" || e.key === "Backspace") removeBlurRegion(index);
      else return;
      e.preventDefault();
      // The window-level shortcut handler would otherwise read the same arrow key as a seek.
      e.stopPropagation();
    });
    return handle;
  }

  /** Reconciles the rings with the areas, reusing the elements already there: rebuilding them all
   * on every change would drop focus out of the one being nudged, and out of the one being
   * dragged. */
  function syncBlurHandles(): void {
    const regions = host.regions();
    while (els.blurLayer.children.length > regions.length) els.blurLayer.lastElementChild!.remove();
    while (els.blurLayer.children.length < regions.length) els.blurLayer.append(createBlurHandle());
    positionBlurHandles();
  }

  /** Lays the rings over the canvas. They are positioned against the stage in display pixels,
   * through the same fit that maps a pointer back to the frame — the canvas box is not always the
   * video's shape, and a ring placed by the box's width alone would sit off the circle it stands
   * for, in a shape the circle is not. This re-runs whenever the canvas is resized. */
  function positionBlurHandles(): void {
    const regions = host.regions();
    const { width, height } = host.frame();
    els.blurLayer.hidden = regions.length === 0;
    const fit = frameFit(els.view.clientWidth, els.view.clientHeight, width, height);
    const left = els.view.offsetLeft + fit.offsetX;
    const top = els.view.offsetTop + fit.offsetY;
    regions.forEach((region, i) => {
      const handle = els.blurLayer.children[i] as HTMLElement | undefined;
      if (!handle) return;
      handle.style.left = `${left + (region.x - region.radius) * fit.scale}px`;
      handle.style.top = `${top + (region.y - region.radius) * fit.scale}px`;
      handle.style.width = `${region.radius * 2 * fit.scale}px`;
      handle.style.height = `${region.radius * 2 * fit.scale}px`;
      handle.classList.toggle("selected", selectedBlur === i);
      handle.setAttribute("aria-label", `Blur area ${i + 1} of ${regions.length}, radius ${region.radius} pixels`);
    });
  }

  els.blurAddBtn.addEventListener("click", () => setBlurArmed(!blurArmed));
  els.view.addEventListener("click", (e) => {
    if (!blurArmed) return;
    const at = sourcePoint(e.clientX, e.clientY);
    addBlurRegion(at.x, at.y);
  });
  els.blurRemoveBtn.addEventListener("click", () => {
    if (selectedBlur !== null) removeBlurRegion(selectedBlur);
  });
  els.blurClearBtn.addEventListener("click", clearBlurRegions);
  // The slider and the number field are two views of one radius: the slider for finding a size
  // against the picture, the field for saying one exactly.
  for (const input of [els.blurRadiusRange, els.blurRadiusValue]) {
    input.addEventListener("input", () => {
      const typed = parseInt(input.value, 10);
      if (Number.isFinite(typed)) setBlurRadius(typed);
    });
    // Writes back whatever was clamped, once the entry has landed.
    input.addEventListener("change", renderBlurTools);
  }
  new ResizeObserver(positionBlurHandles).observe(els.view);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && blurArmed) setBlurArmed(false);
  });

  return { clearRegions: clearBlurRegions, resetRadius: resetBlurRadius, render: renderBlurTools };
}
