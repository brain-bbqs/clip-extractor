export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Turns an upload failure into something a person can act on, rather than a bare status line.
 * Mirrors brain-bbqs/bbqs-uploader's mapping. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Authentication failed: please sign out and sign in again.";
    if (e.status === 403) return "Permission denied: your account cannot add assets to this dataset.";
    if (e.status === 404) return "Not found: check that the dataset still exists and has a draft version.";
  }
  return e instanceof Error ? e.message : String(e);
}
