// Boots the real src/main.ts against the real index.html, once per test file (one file per boot
// scenario). main.ts draws the empty stage into a 2D canvas and hands the blur tool a
// ResizeObserver at boot, neither of which jsdom has, hence the two stubs.
import { createMainHarness } from "@brain-bbqs/test-utils/vitest";

export const { bootMain } = createMainHarness({
  importMain: () => import("../../../src/main"),
  canvas: true,
  observers: ["ResizeObserver"],
});
export { el } from "@brain-bbqs/test-utils/vitest";
