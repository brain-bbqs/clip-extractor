import type { ArchiveConfig } from "./types";
import { apiFetch, listedTitle, type DandisetListResponse } from "./api";

export interface IncomingDandiset {
  identifier: string;
  title: string;
  embargoed: boolean;
}

export interface IncomingDandisetsResult {
  datasets: IncomingDandiset[];
  /**
   * How many "Incoming: " candidates were dropped because their admin-owner check could not be
   * completed at all (service down, CORS, network), as opposed to answering "no". Reported so the
   * UI can say "couldn't verify" instead of the indistinguishable "you have no datasets".
   */
  unverified: number;
}

const INCOMING_PREFIX = "Incoming: ";

/**
 * A small companion service (not part of this repo) that holds the real BBQS/EMBER admin roster
 * server-side and answers only "yes/no" per dandiset, so the roster itself never ships to the
 * browser. Shared with brain-bbqs/bbqs-uploader, which introduced it: hashing a small,
 * semi-public username space client-side doesn't actually keep it confidential, only a
 * server-side check does.
 */
const ADMIN_CHECK_BASE_URL = "https://uploader-codycbakerphd.pythonanywhere.com";

interface AdminOwnedResponse {
  adminOwned: boolean;
}

/**
 * Whether a BBQS/EMBER admin is a listed owner of the given dandiset, per the admin-check service.
 *
 * Deliberately unauthenticated: the service reads the owner list with its own archive credentials,
 * so the signed-in user's access token never leaves the archive and this origin. Don't add an
 * `Authorization` header here without re-reading SECURITY.md — forwarding a live token to a host
 * this repo doesn't control is the exact trade this call was rewritten to avoid.
 */
async function hasAdminOwner(identifier: string): Promise<boolean> {
  const resp = await fetch(`${ADMIN_CHECK_BASE_URL}/admin-owned/${identifier}`);
  if (!resp.ok) {
    throw new Error(`GET /admin-owned/${identifier} failed with HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as AdminOwnedResponse;
  return body.adminOwned === true;
}

/**
 * Dandisets the signed-in user owns whose title starts with "Incoming: " — the BBQS convention
 * for a lab's staging dataset — and that are also co-owned by a BBQS/EMBER admin, so an arbitrary
 * DANDI user can't self-provision an "Incoming: " dataset to use this tool unsupervised.
 * page_size=1000 is the archive's max page size and comfortably covers any one user's owned
 * dandisets, so further pages are never followed.
 */
export async function listIncomingDandisets(cfg: ArchiveConfig): Promise<IncomingDandisetsResult> {
  const resp = await apiFetch<DandisetListResponse>(cfg, "/dandisets/?user=me&embargoed=true&page_size=1000");
  const candidates = (resp?.results ?? [])
    .map((d) => ({
      identifier: d.identifier,
      title: listedTitle(d),
      embargoed: d.embargo_status === "EMBARGOED",
    }))
    .filter((d) => d.title.startsWith(INCOMING_PREFIX));

  // Fail closed: a dandiset whose owner list can't be confirmed is excluded rather than shown.
  // null (the check never completed) is tracked apart from false (it completed and said no), so a
  // service outage doesn't masquerade as "you own no incoming datasets".
  const checks = await Promise.all(
    candidates.map((d) =>
      hasAdminOwner(d.identifier).catch((e: unknown) => {
        console.warn(`Could not verify admin ownership of dandiset ${d.identifier}:`, e);
        return null;
      }),
    ),
  );

  return {
    datasets: candidates.filter((_, i) => checks[i] === true).sort((a, b) => a.title.localeCompare(b.title)),
    unverified: checks.filter((c) => c === null).length,
  };
}
