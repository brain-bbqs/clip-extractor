/**
 * Runs `worker` over every item with at most `limit` in flight at once. Lanes claim the next
 * unclaimed item as they finish, so the pool stays saturated regardless of per-item duration.
 * Rejects on the first worker error, like Promise.all. Ported from brain-bbqs/bbqs-uploader.
 */
export async function runQueue<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  async function lane(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
}
