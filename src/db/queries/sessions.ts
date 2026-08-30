import { eq, and, inArray, ne, sql, desc } from "drizzle-orm";
import { getDb, getDbForProject, type Db } from "@/db/client";
import { sessions } from "@/db/schema";
import { createId, placeholderSlug } from "@/lib/id";
import { getSessionByAlias } from "@/db/queries/session-aliases";
import { parseSessionName } from "@/lib/parse-session-name";
import { listProjects } from "@/lib/projects/registry";
import type { SessionRow, SessionStatus, SessionListRow } from "@/types";

export type { SessionStatus };

/**
 * Statuses that count as "live" — a session the user is actively engaged with:
 * Claude is working (`active`) or halted on the user (`waiting` for an answer,
 * `blocked` on a permission approval). Mirrors ACTIVE_STATUSES in stats.ts and
 * session-archive.ts. Keep these in sync when the status enum changes.
 */
const LIVE_STATUSES: SessionStatus[] = ["active", "waiting", "blocked"];

export interface ResolvedSession {
  session: SessionRow;
  /** Session slug as actually matched — always the session's CURRENT slug. */
  slug: string;
}

/**
 * Resolve a session name to its row. Sessions are flat (ELKY-171): the slug
 * alone is a session's identity, so the exact slug match wins. When it misses,
 * the name may be a retired one — a pre-flatten "<category>/<slug>" or a slug
 * changed by `bertrand rename` — which `session_aliases` keeps resolving. An
 * alias hit returns the session's CURRENT identity, not the alias text.
 *
 * parseSessionName validates segments and throws on empty/invalid input,
 * preserving the callers' existing input-validation behavior.
 */
export function resolveSessionByName(
  name: string,
): ResolvedSession | undefined {
  const { slug } = parseSessionName(name);

  const session = getSessionBySlug(slug);
  if (session) return { session, slug: session.slug };

  return getSessionByAlias(slug);
}

export function createSession(opts: {
  slug: string;
  /** Display name (defaults to the slug). */
  name?: string;
  /** Omitted means 'manual' — every launch path today is a human-typed name. */
  nameSource?: SessionRow["nameSource"];
}) {
  const db = getDb();
  const id = createId();
  return db
    .insert(sessions)
    .values({ id, ...opts, name: opts.name ?? opts.slug })
    .returning()
    .get();
}

export function getSession(
  id: string,
  db: Db = getDb(),
): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export function getSessionBySlug(
  slug: string,
  db: Db = getDb(),
): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.slug, slug)).get();
}

/**
 * A placeholder slug no session currently holds. A collision in the 6-char
 * space is near-impossible, but the retry costs one indexed lookup and the
 * unique slug index still backstops a race.
 */
export function untakenPlaceholderSlug(db: Db = getDb()): string {
  let slug = placeholderSlug();
  while (getSessionBySlug(slug, db)) slug = placeholderSlug();
  return slug;
}

export function getActiveSessions(): SessionListRow[] {
  return getDb()
    .select({ session: sessions })
    .from(sessions)
    .where(inArray(sessions.status, LIVE_STATUSES))
    .all();
}

/**
 * How many sessions are currently live (running or awaiting the user) in a
 * project's DB. Powers the dashboard's "projects with live sessions" default
 * view, so it's a cheap COUNT rather than materializing the rows.
 */
export function countLiveSessions(db: Db = getDb()): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(sessions)
    .where(inArray(sessions.status, LIVE_STATUSES))
    .get();
  return row?.n ?? 0;
}

/**
 * Live-session count across every registered project, not just the calling
 * process's own. `bertrand serve` is a single shared, cross-project resource
 * (one PID file, one port — see server-lifecycle.ts), so its idle-shutdown
 * check can't be answered from one project's DB alone: a session in project
 * "foo" exiting must not tear down the server out from under a still-live
 * session in project "bar". Mirrors the aggregation `/api/projects` already
 * does per-project for the dashboard's live-project view.
 */
export function countLiveSessionsAllProjects(): number {
  return listProjects().reduce(
    (sum, p) => sum + countLiveSessions(getDbForProject(p.slug)),
    0,
  );
}

function selectSessions(
  db: Db,
  opts?: { excludeArchived?: boolean },
): SessionListRow[] {
  const query = db.select({ session: sessions }).from(sessions);

  if (opts?.excludeArchived) {
    // "Exclude archived" means exactly that — everything that isn't archived,
    // including `blocked`. Enumerating the kept statuses here is what silently
    // dropped `blocked` sessions from the sidebar when it was added as a live
    // state, so filter on the one status we actually want to omit instead.
    return query
      .where(ne(sessions.status, "archived"))
      .orderBy(desc(sessions.updatedAt))
      .all();
  }

  return query.orderBy(desc(sessions.updatedAt)).all();
}

export function getAllSessions(opts?: {
  excludeArchived?: boolean;
}): SessionListRow[] {
  return selectSessions(getDb(), opts);
}

/**
 * Sessions for a specific project's DB, tagged with that project's identity so
 * a merged multi-project list (the dashboard sidebar) can label and route each
 * row. Uses `getDbForProject` rather than the active-project resolver, so this
 * is safe to call for projects other than the one the CLI is pinned to.
 */
export function getAllSessionsForProject(
  project: { slug: string; name: string },
  opts?: { excludeArchived?: boolean },
): SessionListRow[] {
  return selectSessions(getDbForProject(project.slug), opts).map((s) => ({
    ...s,
    project,
  }));
}

export function updateSessionStatus(
  id: string,
  status: SessionStatus,
  db: Db = getDb(),
): SessionRow {
  return db
    .update(sessions)
    .set({ status, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function updateSession(
  id: string,
  data: Partial<{
    status: SessionStatus;
    summary: string;
    pid: number | null;
    pidStartedAt: number | null;
    endedAt: string;
    branch: string | null;
  }>,
  db: Db = getDb(),
) {
  return db
    .update(sessions)
    .set({ ...data, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

/**
 * Set the summary WITHOUT bumping updatedAt. Summary derivation is metadata
 * upkeep, not session activity — the lazy sibling backfill in particular
 * would otherwise mark every old session "just now" and wreck recency sorts.
 */
export function setSessionSummary(id: string, summary: string) {
  return getDb()
    .update(sessions)
    .set({ summary })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function setSessionRating(
  id: string,
  rating: number | null,
  db: Db = getDb(),
) {
  return db
    .update(sessions)
    .set({ rating, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

/**
 * A rename is the user speaking, so it stamps nameSource 'manual' — from here
 * on, pause-time derivation must never touch this session's name again.
 */
export function renameSession(id: string, slug: string, name?: string) {
  return getDb()
    .update(sessions)
    .set({
      slug,
      name: name ?? slug,
      nameSource: "manual",
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

/**
 * Whether any *other* session in this project DB holds `slug`. The slug is
 * the session's whole identity (unique index `sessions_slug`), so this is the
 * duplicate check for both the derivation engine and `bertrand rename`.
 */
export function isSlugTakenByOtherSession(
  slug: string,
  sessionId: string,
  db: Db = getDb(),
): boolean {
  const row = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.slug, slug), ne(sessions.id, sessionId)))
    .limit(1)
    .get();
  return row !== undefined;
}

/**
 * Set slug and name from pause-time derivation WITHOUT bumping updatedAt.
 * Same rationale as setSessionSummary: derivation is metadata upkeep, not
 * session activity, and must not push old sessions to the top of recency
 * sorts. nameSource is deliberately untouched — callers only reach this for
 * rows already marked 'derived'.
 */
export function setDerivedSessionSlug(
  id: string,
  slug: string,
  db: Db = getDb(),
) {
  return db
    .update(sessions)
    .set({ slug, name: slug })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

/**
 * Permanently remove a session row. Every child table (events, conversations,
 * stats, label joins) declares `onDelete: "cascade"` and `PRAGMA foreign_keys`
 * is ON, so this takes the session's entire history with it.
 *
 * Unguarded by design — callers decide whether deletion is allowed. Reach for
 * `discardSession` (src/lib/session-actions.ts) unless you have already
 * established the session is not live.
 */
export function deleteSession(id: string, db: Db = getDb()) {
  return db
    .delete(sessions)
    .where(eq(sessions.id, id))
    .run();
}
