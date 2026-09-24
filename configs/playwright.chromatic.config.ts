import { defineConfig } from "@playwright/test";
import { createPlaywrightConfig } from "@brain-bbqs/config/playwright";

// The shared config's one Desktop Chrome project is deliberately not joined by phone or tablet
// projects: the viewports each snapshot is taken at are set per test instead, since Chromatic keys
// an archive by the test's title alone. See VIEWPORTS in tests/integration/layout.ts.
export default defineConfig(createPlaywrightConfig({ rootDir: new URL("..", import.meta.url), testDir: "../tests/chromatic" }));
