import { devices, type PlaywrightTestConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

/** Settings shared by the integration (playwright.config.ts) and Chromatic
 * (playwright.chromatic.config.ts) runs — everything but the testDir. */
export const sharedConfig: PlaywrightTestConfig = {
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173",
    url: "http://localhost:4173",
    cwd: rootDir,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Set PLAYWRIGHT_CHROMIUM_PATH to reuse a pre-installed browser binary
        // (e.g. in sandboxes that pin a browser outside of `playwright install`).
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
      },
    },
  ],
};
