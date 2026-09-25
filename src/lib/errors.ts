import { friendlyError as friendlyArchiveError, type FriendlyMessages } from "@brain-bbqs/ember-client";

/** Where this app's wording differs from the shared defaults: a delivery adds assets to a dataset. */
export const CLIP_EXTRACTOR_MESSAGES: FriendlyMessages = {
  403: "Permission denied: your account cannot add assets to this dataset.",
};

/** Turns a failure into something a person can act on, in this app's words. */
export function friendlyError(e: unknown): string {
  return friendlyArchiveError(e, CLIP_EXTRACTOR_MESSAGES);
}
