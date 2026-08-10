import { readFileSync } from "node:fs";

// Chromatic re-snapshots any page/story where this string changes, so
// Storybook and the Chromatic Playwright build pin it to a static value
// instead of the real (frequently-bumped) package.json version.
const CHROMATIC_PLACEHOLDER_VERSION = "0.0.0";

export function resolveAppVersion(): string {
  if (process.env.CHROMATIC_STATIC_VERSION) {
    return CHROMATIC_PLACEHOLDER_VERSION;
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
    version: string;
  };
  return pkg.version;
}
