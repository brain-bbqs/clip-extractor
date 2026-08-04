import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: rootDir,
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
