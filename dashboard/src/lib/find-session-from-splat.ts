import type { SessionListRow } from "../api/types";

/**
 * Resolve a URL splat to a session by direct string match against the slug.
 * Slugs may legitimately contain slashes (e.g. `REV-367/fe-determination`),
 * so the whole trimmed splat is one identity.
 */
export function findSessionFromSplat(
  splat: string,
  sessions: SessionListRow[],
): SessionListRow | null {
  const trimmed = splat.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return null;
  return sessions.find((s) => s.session.slug === trimmed) ?? null;
}
