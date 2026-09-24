import { defineConfig } from "@playwright/test";
import { createPlaywrightConfig } from "@brain-bbqs/config/playwright";

export default defineConfig(createPlaywrightConfig({ rootDir: new URL("..", import.meta.url), testDir: "../tests/integration" }));
