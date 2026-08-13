import type { ArchiveConfig } from "./types";
import { apiFetch } from "./api";

// The human-subjects gate, shared verbatim with brain-bbqs/bbqs-uploader (src/lib/humanSubjects.ts
// there): a dataset holding recordings of people is flagged by admins in its draft description, and
// both tools read that flag the same way so a lab sees the same warning whichever one it uploads
// through.

/**
 * The BBQS convention for flagging a staging dataset as holding human-subjects data: admins put
 * this exact phrase (case-sensitive) somewhere in the draft's description.
 */
export const HUMAN_SUBJECTS_PHRASE = "CONTAINS HUMAN SUBJECTS";

/** The slice of a draft version's metadata this app reads. */
export interface DraftVersionMetadata {
  description?: string;
}

export function containsHumanSubjects(metadata: DraftVersionMetadata | null): boolean {
  return metadata?.description?.includes(HUMAN_SUBJECTS_PHRASE) ?? false;
}

export async function fetchDraftMetadata(cfg: ArchiveConfig): Promise<DraftVersionMetadata | null> {
  return apiFetch<DraftVersionMetadata>(cfg, `/dandisets/${cfg.dandisetId}/versions/draft/`);
}
