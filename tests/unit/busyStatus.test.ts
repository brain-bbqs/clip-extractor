import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusyStatus, type BusyStatusElements } from "../../src/ui/busyStatus";

function makeStatus(minVisibleMs = 400): { status: BusyStatus; els: BusyStatusElements } {
  const make = (): HTMLElement => document.createElement("span");
  const els: BusyStatusElements = { root: make(), label: make(), detail: make() };
  els.root.hidden = true;
  return { status: new BusyStatus(els, { minVisibleMs }), els };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("show", () => {
  it("raises the indicator with what is being waited on", () => {
    const { status, els } = makeStatus();
    status.show("Loading mice.mp4…", "12.4 MB read");
    expect(els.root.hidden).toBe(false);
    expect(els.label.textContent).toBe("Loading mice.mp4…");
    expect(els.detail.textContent).toBe("12.4 MB read");
    expect(status.showing).toBe(true);
  });

  it("clears a detail the previous call left behind, so a stale byte count cannot linger", () => {
    const { status, els } = makeStatus();
    status.show("Downloading mice.mp4…", "12.4 MB of 40.0 MB");
    status.show("Loading mice.mp4…");
    expect(els.detail.textContent).toBe("");
  });
});

describe("showAfter", () => {
  it("draws nothing when the wait ends inside the delay", () => {
    const { status, els } = makeStatus();
    status.showAfter(250, "Loading frame…");
    vi.advanceTimersByTime(200);
    status.hide();
    vi.advanceTimersByTime(1000);
    expect(els.root.hidden).toBe(true);
    expect(els.label.textContent).toBe("");
  });

  it("raises the indicator once the wait outlasts the delay", () => {
    const { status, els } = makeStatus();
    status.showAfter(250, "Loading frame…");
    vi.advanceTimersByTime(250);
    expect(els.root.hidden).toBe(false);
    expect(els.label.textContent).toBe("Loading frame…");
  });

  it("leaves what is already on screen alone — a load outranks the seek it makes on arrival", () => {
    const { status, els } = makeStatus();
    status.show("Loading mice.mp4…", "12.4 MB read");
    status.showAfter(250, "Loading frame…");
    vi.advanceTimersByTime(1000);
    expect(els.label.textContent).toBe("Loading mice.mp4…");
    expect(els.detail.textContent).toBe("12.4 MB read");
  });

  it("keeps the first deferred label when a second wait is declared before either is drawn", () => {
    const { status, els } = makeStatus();
    status.showAfter(250, "Loading frame…");
    vi.advanceTimersByTime(100);
    status.showAfter(250, "Loading a different frame…");
    vi.advanceTimersByTime(150);
    expect(els.label.textContent).toBe("Loading frame…");
  });
});

describe("hide", () => {
  it("holds the indicator up for its minimum, so a run of slow frames is one wait rather than a blink", () => {
    const { status, els } = makeStatus(400);
    status.show("Loading frame…");
    vi.advanceTimersByTime(50);
    status.hide();
    expect(els.root.hidden).toBe(false);
    vi.advanceTimersByTime(349);
    expect(els.root.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(els.root.hidden).toBe(true);
  });

  it("takes the indicator down at once when it has already been up for its minimum", () => {
    const { status, els } = makeStatus(400);
    status.show("Loading frame…");
    vi.advanceTimersByTime(400);
    status.hide();
    expect(els.root.hidden).toBe(true);
  });

  it("keeps the indicator up when the next wait starts before the held-off hide lands", () => {
    const { status, els } = makeStatus(400);
    status.show("Loading frame…");
    status.hide();
    vi.advanceTimersByTime(100);
    status.showAfter(250, "Loading frame…");
    vi.advanceTimersByTime(1000);
    expect(els.root.hidden).toBe(false);
    expect(els.label.textContent).toBe("Loading frame…");
  });

  it("does nothing to an indicator that was never raised", () => {
    const { status, els } = makeStatus();
    status.hide();
    vi.advanceTimersByTime(1000);
    expect(els.root.hidden).toBe(true);
  });

  it("clears the label and the detail once it lands", () => {
    const { status, els } = makeStatus(0);
    status.show("Downloading mice.mp4…", "12.4 MB of 40.0 MB");
    status.hide();
    expect(els.label.textContent).toBe("");
    expect(els.detail.textContent).toBe("");
  });
});
