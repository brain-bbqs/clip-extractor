import { createStorybookMain } from "@brain-bbqs/config/storybook";

export default createStorybookMain({
  packageJson: new URL("../../package.json", import.meta.url),
  // The App story injects index.html's markup raw (see stories/App.stories.ts), so its
  // /src/assets/... img URLs bypass Vite's asset pipeline; serve the assets at that same path so
  // the images resolve in both the dev server and the built Storybook.
  staticDirs: [{ from: "../../src/assets", to: "/src/assets" }],
});
