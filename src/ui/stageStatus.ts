/**
 * The line over the player saying what it is waiting on.
 *
 * Streaming moved most of the waiting out of the load and into the player: a recording opens after
 * its container index has been read, which for a multi-gigabyte file is tens of megabytes over the
 * network, and a seek into a stretch nothing has decoded yet is another round trip. Both used to
 * show as a stage that simply did not change until the frame arrived, with the only word of it in
 * the browser console, which is not where someone waiting for a video is looking.
 *
 * Two pieces of timing keep the indicator from becoming its own annoyance. A wait may be declared
 * only after it has lasted a while, so the great majority of seeks — served from the decoded-frame
 * cache in a few milliseconds — never draw anything; and once drawn it stays up for a short minimum,
 * so a run of slow frames reads as one continuous wait rather than a spinner blinking once per
 * frame.
 */
export interface StageStatusElements {
  /** The overlay itself, raised and lowered by the `hidden` attribute. */
  root: HTMLElement;
  /** What is being waited on. */
  label: HTMLElement;
  /** How far along it is, if that can be said — a byte count, typically. */
  detail: HTMLElement;
}

export interface StageStatusOptions {
  /** How long the indicator stays up once raised. */
  minVisibleMs?: number;
}

const DEFAULT_MIN_VISIBLE_MS = 400;

export class StageStatus {
  private readonly minVisibleMs: number;
  /** A deferred {@link showAfter}, with the label it will raise. */
  private pending: { timer: ReturnType<typeof setTimeout>; label: string } | null = null;
  /** A {@link hide} held off until the minimum visible time is up. */
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private shownAt = 0;

  constructor(
    private readonly els: StageStatusElements,
    { minVisibleMs = DEFAULT_MIN_VISIBLE_MS }: StageStatusOptions = {},
  ) {
    this.minVisibleMs = minVisibleMs;
  }

  /** Whether the indicator is on screen. */
  get showing(): boolean {
    return !this.els.root.hidden;
  }

  /** Says what is being waited on, now. `detail` is the running count beside it, cleared when it is
   * not given, so a caller that reports progress just calls this again with the new figure. */
  show(label: string, detail = ""): void {
    this.cancelPending();
    this.cancelHide();
    if (!this.showing) this.shownAt = Date.now();
    this.els.label.textContent = label;
    this.els.detail.textContent = detail;
    this.els.root.hidden = false;
  }

  /** Says what is being waited on once `delayMs` has passed without a {@link hide}. A wait that ends
   * inside the delay draws nothing at all, which is what keeps an already-decoded frame from
   * flashing a spinner on every arrow key. Whatever the indicator is already saying is left alone —
   * a load in progress outranks the seek it is about to make. */
  showAfter(delayMs: number, label: string): void {
    if (this.pending) return;
    if (this.showing) {
      // Up already, and now wanted again: whatever was about to lower it no longer applies.
      this.cancelHide();
      return;
    }
    const timer = setTimeout(() => {
      this.pending = null;
      this.show(label);
    }, delayMs);
    this.pending = { timer, label };
  }

  /** Takes the indicator down, once it has been up for its minimum. Cancels a deferred
   * {@link showAfter} outright: a wait that ended before it was ever declared is one nobody has to
   * be told about. */
  hide(): void {
    this.cancelPending();
    if (!this.showing || this.hideTimer) return;
    const remaining = this.minVisibleMs - (Date.now() - this.shownAt);
    if (remaining <= 0) {
      this.clear();
      return;
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.clear();
    }, remaining);
  }

  private clear(): void {
    this.els.root.hidden = true;
    this.els.label.textContent = "";
    this.els.detail.textContent = "";
  }

  private cancelPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private cancelHide(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
