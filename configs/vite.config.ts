import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { createViteConfig, prePaintPlugin } from "@brain-bbqs/config/vite";
// With the extension: Vite's native config loader (its future default) refuses extensionless
// imports between config files.
import { STORAGE_KEY, THEME_KEY } from "../src/lib/settings.ts";

export default defineConfig(
  createViteConfig({
    rootDir: new URL("..", import.meta.url),
    overrides: {
      plugins: [prePaintPlugin({ themeKey: THEME_KEY, settingsKey: STORAGE_KEY })],
      resolve: {
        alias: {
          // @talmolab/sleap-io.js's package.json lists the "import" condition before "browser" in its
          // exports map, so condition-ordering resolvers (including Vite/Rolldown) pick the Node
          // build even for a browser target, which pulls in the optional `skia-canvas` (Node-only
          // canvas fallback) and its own unmet `jszip` dependency, breaking the build. Point straight
          // at the package's browser entry to sidestep that.
          "@talmolab/sleap-io.js": fileURLToPath(new URL("../node_modules/@talmolab/sleap-io.js/dist/index.browser.js", import.meta.url)),
        },
      },
      build: {
        rolldownOptions: {
          // sleap-io.js dynamically `import()`s the optional Node-only `skia-canvas` package as a
          // fallback image rasterizer, guarded by a try/catch that degrades to a friendly error in
          // any environment (like the browser) where it isn't installed. Rolldown still tries to
          // resolve that dynamic import eagerly at build time, and skia-canvas's own browser build
          // requires `jszip`, which isn't installed as a real dependency here. Externalizing both
          // leaves that guarded, browser-unreachable code path as a real (never-executed) import.
          external: ["skia-canvas", "jszip"],
        },
      },
    },
  }),
);
