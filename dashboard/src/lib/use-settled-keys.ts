import { useRef } from "react";

/** Baseline of already-seen keys, or `null` before the list first settles. */
export type SettledKeys<K> = ReadonlySet<K> | null;

/**
 * The keys already on screen once a polled list first settles. Callers treat
 * members as pre-existing and anything else as a genuine live arrival — the
 * gate behind the sidebar's reveal animations.
 *
 * Seeded from the first *non-empty* payload rather than on mount: a react-query
 * list starts out empty while it loads, and baselining against that would mark
 * the whole backlog as new and animate everything at once, which is the exact
 * thing this guards against. A list that never grows (a paused session, which
 * never polls) therefore baselines to everything and never animates.
 *
 * Held in a ref so seeding never schedules a render, and read during render so a
 * row that just arrived animates on its very first paint instead of a frame late.
 */
export function useSettledKeys<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
): SettledKeys<K> {
  const baseline = useRef<SettledKeys<K>>(null);
  if (baseline.current === null && items.length > 0) {
    baseline.current = new Set(items.map(keyOf));
  }
  return baseline.current;
}

/**
 * Whether `key` arrived after the list settled. False while the baseline is
 * still unseeded, so nothing animates before we know what "already there" means.
 */
export function isFreshKey<K>(settled: SettledKeys<K>, key: K): boolean {
  return settled !== null && !settled.has(key);
}
