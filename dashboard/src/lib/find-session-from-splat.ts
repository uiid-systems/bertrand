import type { SessionWithCategory } from "../api/types";

/**
 * Resolve a URL splat (e.g. `ssp/REV-367/fe-determination`) to a session by
 * direct string match against `<categoryPath>/<slug>`. Works for both flat
 * categories with slash-bearing slugs (new model) and legacy nested categories
 * stored as multi-segment paths.
 */
export function findSessionFromSplat(
  splat: string,
  sessions: SessionWithCategory[],
): SessionWithCategory | null {
  const trimmed = splat.replace(/^\/+|\/+$/g, "");
  if (!trimmed.includes("/")) return null;
  return (
    sessions.find(
      (s) => `${s.categoryPath}/${s.session.slug}` === trimmed,
    ) ?? null
  );
}
