import { createArchiveSettingsStore } from "@brain-bbqs/ember-client";
import type { StoredSettings } from "./types";

// Both keys are also read before first paint by the script configs/vite.config.ts injects into
// index.html. Renaming STORAGE_KEY would sign every visitor out on the next deploy.
export const STORAGE_KEY = "clip-extractor.settings.v1";
export const THEME_KEY = "clip-extractor.theme";

// The OAuth token set lives in here, in localStorage: an accepted, documented trade-off for a
// backend-free page (see SECURITY.md, "Handling a 'clear text storage' alert on a new credential").
export const settingsStore = createArchiveSettingsStore<StoredSettings>(STORAGE_KEY);
