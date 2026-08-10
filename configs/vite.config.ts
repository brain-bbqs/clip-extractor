import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { resolveAppVersion } from "./appVersion.ts";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: rootDir,
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  // Relative base: the built app is served from a subpath (vibes.tlab.sh/clip-extractor/), not
  // domain root, so asset URLs must resolve relative to wherever the gh-pages branch is mounted.
  base: "./",
  resolve: {
    alias: {
      // @talmolab/sleap-io.js's package.json lists the "import" condition before "browser" in its
      // exports map, so condition-ordering resolvers (including Vite/Rolldown) pick the Node
      // build even for a browser target — which pulls in the optional `skia-canvas` (Node-only
      // canvas fallback) and its own unmet `jszip` dependency, breaking the build. Point straight
      // at the package's browser entry to sidestep that.
      "@talmolab/sleap-io.js": fileURLToPath(new URL("../node_modules/@talmolab/sleap-io.js/dist/index.browser.js", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      // sleap-io.js dynamically `import()`s the optional Node-only `skia-canvas` package as a
      // fallback image rasterizer, guarded by a try/catch that degrades to a friendly error in
      // any environment (like the browser) where it isn't installed. Rolldown still tries to
      // resolve that dynamic import eagerly at build time, and skia-canvas's own browser build
      // requires `jszip`, which isn't installed as a real dependency here — externalizing both
      // leaves that guarded, browser-unreachable code path as a real (never-executed) import.
      external: ["skia-canvas", "jszip"],
    },
  },
});
