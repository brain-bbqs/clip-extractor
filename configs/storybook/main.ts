import type { StorybookConfig } from "@storybook/html-vite";
import { resolveAppVersion } from "../appVersion.ts";

const config: StorybookConfig = {
  stories: ["../../stories/**/*.stories.@(ts|js)"],
  addons: [],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  // The App story injects index.html's markup raw (see stories/App.stories.ts), so its
  // /src/assets/... img URLs bypass Vite's asset pipeline; serve the assets at that same path so
  // the images resolve in both the dev server and the built Storybook.
  staticDirs: [{ from: "../../src/assets", to: "/src/assets" }],
  viteFinal(config) {
    config.define = {
      ...config.define,
      __APP_VERSION__: JSON.stringify(resolveAppVersion()),
    };
    return config;
  },
};

export default config;
