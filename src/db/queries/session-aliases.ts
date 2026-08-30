import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { sessionAliases, sessions } from "@/db/schema";
import type { ResolvedSession } from "@/db/queries/sessions";

/**
 * Record a retired canonical name for a session. INSERT OR IGNORE semantics:
 * re-recording an existing alias is a no-op rather than an error, so the same
 * rename (or a bulk backfill) can safely run twice. An alias already claimed
 * by a different session is also left untouched — callers that care check
 * `isAliasTakenByOtherSession` first.
 */
export function recordSessionAlias(
  alias: string,
  sessionId: string,
  db: Db = getDb(),
) {
  db.insert(sessionAliases)
    .values({ alias, sessionId })
    .onConflictDoNothing()
    .run();
}

/**
 * Resolve an alias to its session, shaped like `resolveSessionByName`'s
 * result: `slug` reflects the session's CURRENT identity, never the alias
 * text — callers use it to render the canonical name the alias now points at.
 */
export function getSessionByAlias(
  alias: string,
  db: Db = getDb(),
): ResolvedSession | undefined {
  const row = db
    .select({ session: sessions })
    .from(sessionAliases)
    .innerJoin(sessions, eq(sessionAliases.sessionId, sessions.id))
    .where(eq(sessionAliases.alias, alias))
    .get();
  if (!row) return undefined;
  return { session: row.session, slug: row.session.slug };
}

/**
 * Whether `alias` is already claimed by a session other than `sessionId`.
 * `sessionId` null means "nothing is exempt" — the caller has no row yet.
 */
export function isAliasTakenByOtherSession(
  alias: string,
  sessionId: string | null,
  db: Db = getDb(),
): boolean {
  const resolved = getSessionByAlias(alias, db);
  return resolved !== undefined && resolved.session.id !== sessionId;
}
