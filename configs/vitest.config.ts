import { defineConfig } from "vitest/config";
import { createVitestConfig } from "@brain-bbqs/config/vitest";

export default defineConfig(
  createVitestConfig({
    rootDir: new URL("..", import.meta.url),
    environment: "jsdom",
    coverageInclude: ["src/lib/**/*.ts"],
  }),
);
