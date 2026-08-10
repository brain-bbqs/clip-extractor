/**
 * A one-slot async memo: keeps the last value produced and hands it straight back whenever the same
 * key is asked for again, running `produce` only when the key differs from the one held.
 *
 * One slot rather than a map, because what this exists for is an immediate repeat — delivering the
 * same selection twice, once saved and once uploaded — and a map would instead accumulate a blob
 * per selection ever made. Moving on to a different selection is exactly the point at which the
 * held value stops being worth keeping.
 *
 * A failed `produce` caches nothing: the slot keeps whatever it held, and the rejection is passed
 * to the caller.
 */
export function memoOne<T>(): (key: string, produce: () => Promise<T>) => Promise<T> {
  let cached: { key: string; value: T } | null = null;
  return async (key, produce) => {
    if (cached?.key !== key) cached = { key, value: await produce() };
    return cached.value;
  };
}
