import { defineConfig } from "vitest/config";
import { createVitestConfig } from "@brain-bbqs/config/vitest";

// The live checks in tests/live, run against EMBER's real bucket and API rather than fixtures. Kept
// out of the default `npm test` glob because they depend on the network and on services this repo
// does not control; .github/workflows/daily_live_checks.yml runs them once a day. Retries absorb a
// passing network hiccup, so an email means EMBER kept failing for the whole run.
export default defineConfig(
  createVitestConfig({
    rootDir: new URL("..", import.meta.url),
    environment: "jsdom",
    include: ["tests/live/**/*.test.ts"],
    overrides: { test: { testTimeout: 120_000, retry: 2 } },
  }),
);
