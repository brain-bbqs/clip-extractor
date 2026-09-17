import { expect, type Page } from "@playwright/test";

// Layout checks shared by the Chromatic snapshots and any spec that wants to look at the page at
// something other than the Desktop Chrome default the suite runs under.

/**
 * The viewports a page is looked at across: the two device classes in both orientations, plus the
 * desktop width the suite started at (the Desktop Chrome default in playwright.shared.ts).
 *
 * The Chromatic run applies these per test rather than as Playwright projects, since Chromatic
 * keys an archive by the test's title alone: run as projects, each viewport would write over the
 * last one's manifest and only the project that ran last would reach Chromatic at all. Naming the
 * viewport in the test title keeps them apart.
 */
export const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "mobile portrait", width: 390, height: 844 },
  { name: "mobile landscape", width: 844, height: 390 },
] as const;

/**
 * Asserts that the page does not scroll sideways at the current viewport, and names the elements
 * that overflow it when it does. This is the failure a narrow viewport hits first (a row of
 * controls that cannot wrap runs off the screen) and it is far easier to act on as a named element
 * than as a pixel diff in a snapshot.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth, offenders } = await page.evaluate(() => {
    const root = document.documentElement;
    const offenders: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      // Shapes inside an inline <svg> are drawn in its own coordinate space and can report widths
      // in the thousands; the <svg> that holds them is what is checked. ownerSVGElement is null on
      // that outermost <svg> and set only on what is nested inside it.
      if ((el as SVGElement).ownerSVGElement) return;
      const { width } = el.getBoundingClientRect();
      if (width > root.clientWidth + 1) {
        const id = el.id ? `#${el.id}` : "";
        const names = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
        const classes = names.length ? `.${names.join(".")}` : "";
        offenders.push(`${el.tagName.toLowerCase()}${id}${classes} (${Math.round(width)}px)`);
      }
    });
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders };
  });
  expect(offenders, `Elements wider than the ${clientWidth}px viewport`).toEqual([]);
  expect(scrollWidth, `Page scrolls sideways at ${clientWidth}px`).toBeLessThanOrEqual(clientWidth + 1);
}
