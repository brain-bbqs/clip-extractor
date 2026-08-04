import { defineConfig } from "@playwright/test";
import { sharedConfig } from "./playwright.shared";

export default defineConfig({
  ...sharedConfig,
  testDir: "../tests/integration",
});
