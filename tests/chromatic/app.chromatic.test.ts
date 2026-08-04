import { test, expect } from "@chromatic-com/playwright";

test("Main page - default (no video loaded)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Clip Extractor");
  await expect(page.locator("#emptyStage")).toBeVisible();
  await expect(page.locator("#btnUpload")).toBeDisabled();
});
