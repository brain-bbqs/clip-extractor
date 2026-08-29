import { describe, expect, it } from "vitest";
import { InterruptedError, isInterruption, throwIfInterrupted } from "../../src/lib/interrupt";

describe("isInterruption", () => {
  it("recognizes the error the delivery steps raise themselves", () => {
    expect(isInterruption(new InterruptedError())).toBe(true);
  });

  it("recognizes the AbortError fetch and ffmpeg.wasm reject an aborted call with", () => {
    expect(isInterruption(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("recognizes mediabunny's own cancellation, which a stopped stream trim comes back as", () => {
    const canceled = new Error("Conversion has been canceled.");
    canceled.name = "ConversionCanceledError";
    expect(isInterruption(canceled)).toBe(true);
  });

  it("leaves a real failure alone, so it is still reported as one", () => {
    expect(isInterruption(new Error("ffmpeg produced an empty clip"))).toBe(false);
    expect(isInterruption("Upload stopped")).toBe(false);
  });
});

describe("throwIfInterrupted", () => {
  it("does nothing while the delivery has not been stopped", () => {
    expect(() => throwIfInterrupted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfInterrupted(undefined)).not.toThrow();
  });

  it("ends the step once the signal is tripped", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfInterrupted(controller.signal)).toThrow(InterruptedError);
  });
});
