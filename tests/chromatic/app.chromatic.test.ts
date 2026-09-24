import { test, expect } from "@chromatic-com/playwright";
import { expectNoHorizontalOverflow, forEachViewport } from "@brain-bbqs/test-utils/playwright";

forEachViewport(test, "Main page - default (no video loaded)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Clip Extractor");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#btnUpload")).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});
