import { test, expect } from "@playwright/test";

test("loads the app shell with the player disabled", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Clip Extractor");
  await expect(page.locator("h1")).toContainText("Clip Extractor");
  await expect(page.locator("#emptyStage")).toBeVisible();
  await expect(page.locator("#view")).toBeHidden();
  await expect(page.locator("#btnExtract")).toBeDisabled();
  await expect(page.locator("#btnPlay")).toBeDisabled();
});

test("extract panel toggles between clip and frame output", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#clipOpts")).toBeVisible();
  await expect(page.locator("#framesOpts")).toBeHidden();

  await page.locator('#outSeg button[data-out="frames"]').click();
  await expect(page.locator("#clipOpts")).toBeHidden();
  await expect(page.locator("#framesOpts")).toBeVisible();

  await page.locator('#outSeg button[data-out="clip"]').click();
  await expect(page.locator("#clipOpts")).toBeVisible();
  await expect(page.locator("#framesOpts")).toBeHidden();
});

test("transmit panel is marked coming soon", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#txPanel")).toHaveClass(/disabledpanel/);
  await expect(page.locator("#txPanel .comingSoonOverlay")).toBeVisible();
});
