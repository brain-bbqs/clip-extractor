import { test, expect } from "@chromatic-com/playwright";
import { VIEWPORTS, expectNoHorizontalOverflow } from "../integration/layout";

// One test per viewport rather than one per Playwright project: see VIEWPORTS for why. The Chromatic
// fixture snapshots the page after each test body, named by the test's title, so the viewport in
// the title is what tells the captures apart.
for (const viewport of VIEWPORTS) {
  test(`Main page - default (no video loaded) [${viewport.name}]`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Clip Extractor");
    await expect(page.locator("#dropzone")).toBeVisible();
    await expect(page.locator("#btnUpload")).toBeDisabled();
    await expectNoHorizontalOverflow(page);
  });
}
