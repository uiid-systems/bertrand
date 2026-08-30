import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { sessionAliases, sessions, categories } from "@/db/schema";
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
 * result: `categoryPath`/`slug` reflect the session's CURRENT identity (its
 * actual category and slug), never the alias text — callers use them to
 * render the canonical name the alias now points at.
 */
export function getSessionByAlias(
  alias: string,
  db: Db = getDb(),
): ResolvedSession | undefined {
  const row = db
    .select({ session: sessions, categoryPath: categories.path })
    .from(sessionAliases)
    .innerJoin(sessions, eq(sessionAliases.sessionId, sessions.id))
    .innerJoin(categories, eq(sessions.categoryId, categories.id))
    .where(eq(sessionAliases.alias, alias))
    .get();
  if (!row) return undefined;
  return { ...row, slug: row.session.slug };
}

/** Whether `alias` is already claimed by a session other than `sessionId`. */
export function isAliasTakenByOtherSession(
  alias: string,
  sessionId: string,
  db: Db = getDb(),
): boolean {
  const resolved = getSessionByAlias(alias, db);
  return resolved !== undefined && resolved.session.id !== sessionId;
}
