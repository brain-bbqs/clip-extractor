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

test("delivery card defaults to Download while signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('#deliverSeg button[data-deliver="download"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#uploadPane")).toBeHidden();
  await expect(page.locator("#btnDownload")).toBeDisabled();
  await expect(page.locator("#downloadStatus")).toContainText("Load a video");
});

test("delivery toggle swaps between the download and upload panes", async ({ page }) => {
  await page.goto("/");

  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(page.locator("#uploadPane")).toBeVisible();
  await expect(page.locator("#downloadPane")).toBeHidden();
  // The recommended companion upload is on by default.
  await expect(page.locator("#uploadOriginal")).toBeChecked();

  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#uploadPane")).toBeHidden();
});

test("the chosen delivery side survives a refresh", async ({ page }) => {
  await page.goto("/");
  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(page.locator("#uploadPane")).toBeVisible();

  await page.reload();

  // Without the choice being persisted, the sign-in default would decide this again on every load.
  await expect(page.locator('#deliverSeg button[data-deliver="upload"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#uploadPane")).toBeVisible();
  await expect(page.locator("#downloadPane")).toBeHidden();

  await page.locator('#deliverSeg button[data-deliver="download"]').click();
  await page.reload();
  await expect(page.locator("#downloadPane")).toBeVisible();
  await expect(page.locator("#uploadPane")).toBeHidden();
});

test("upload pane prompts for sign-in while signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#oauthSigninBtn")).toBeVisible();
  await expect(page.locator("#oauthSignedIn")).toBeHidden();
  await page.locator('#deliverSeg button[data-deliver="upload"]').click();
  await expect(page.locator("#dandisetMessage")).toContainText("sign in");
  await expect(page.locator("#dandisetId")).toBeHidden();
  await expect(page.locator("#viewDatasetLink")).toBeHidden();
  await expect(page.locator("#btnUpload")).toBeDisabled();
});

test("sign-in button starts the EMBER OAuth redirect", async ({ page }) => {
  await page.goto("/");
  // The archive itself is out of scope for this smoke test: intercept the redirect and assert
  // only that the app leaves for the right authorize URL.
  await page.route("https://api-dandi.emberarchive.org/**", (route) => route.fulfill({ body: "" }));
  await page.locator("#oauthSigninBtn").click();
  await page.waitForURL(/api-dandi\.emberarchive\.org\/oauth\/authorize\//);
  const url = new URL(page.url());
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("response_type")).toBe("code");
});
