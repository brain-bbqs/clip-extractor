import { test, expect } from "@playwright/test";

test("loads the app shell with the player disabled", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Clip Extractor");
  await expect(page.locator("h1")).toContainText("Clip Extractor");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#emptyStage")).toBeVisible();
  await expect(page.locator("#view")).toBeHidden();
  await expect(page.locator("#btnPlay")).toBeDisabled();
  await expect(page.locator("#btnUpload")).toBeDisabled();
});

test("source toggle swaps between the local dropzone and the EMBER stream pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#emberPane")).toBeHidden();

  await page.locator('#srcSeg button[data-src="ember"]').click();
  await expect(page.locator("#dropzone")).toBeHidden();
  await expect(page.locator("#emberUrl")).toBeVisible();

  await page.locator('#srcSeg button[data-src="local"]').click();
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#emberPane")).toBeHidden();
});

test("mode toggle switches the selector between range and single frame", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#btnSetIn")).toBeVisible();
  await expect(page.locator("#btnSetOut")).toBeVisible();
  await expect(page.locator("#selbar")).toBeVisible();

  await page.locator('#modeSeg button[data-mode="frame"]').click();
  await expect(page.locator("#btnSetIn")).toBeHidden();
  await expect(page.locator("#btnSetOut")).toBeHidden();
  await expect(page.locator("#selbar")).toBeHidden();

  await page.locator('#modeSeg button[data-mode="video"]').click();
  await expect(page.locator("#btnSetIn")).toBeVisible();
  await expect(page.locator("#btnSetOut")).toBeVisible();
  await expect(page.locator("#selbar")).toBeVisible();
});

test("SLEAP annotations card is revealed by its toggle (default off)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#slpToggle")).not.toBeChecked();
  await expect(page.locator("#slpCard")).toBeHidden();

  await page.locator("#slpToggle").check();
  await expect(page.locator("#slpCard")).toBeVisible();
  await expect(page.locator("#slpDropzone")).toBeVisible();

  await page.locator("#slpToggle").uncheck();
  await expect(page.locator("#slpCard")).toBeHidden();
});

test("upload card is marked coming soon", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#uploadCard")).toHaveClass(/disabledpanel/);
  await expect(page.locator("#uploadCard .comingSoonOverlay")).toBeVisible();
  await expect(page.locator("#btnUpload")).toBeDisabled();
});
