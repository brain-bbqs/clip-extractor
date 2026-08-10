import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolveAppVersion } from "./appVersion.ts";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: rootDir,
  // Same injection vite.config.ts performs, so any module reading __APP_VERSION__ can be imported
  // under vitest without the identifier being undefined.
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.d.ts", "**/*.test.ts", "tests/**", "configs/**"],
      reporter: ["text", "lcov", "json"],
    },
  },
});
