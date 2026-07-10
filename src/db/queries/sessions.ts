import { eq, and, inArray, ne, sql, desc } from "drizzle-orm";
import { getDb, getDbForProject, type Db } from "@/db/client";
import { sessions, categories } from "@/db/schema";
import { createId } from "@/lib/id";
import { getCategoryByPath } from "@/db/queries/categories";
import { parseSessionName } from "@/lib/parse-session-name";
import type { SessionRow, SessionStatus, SessionWithCategory } from "@/types";

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
  /**
   * Category path as actually matched — the flat root for current-model rows,
   * or the full nested path for legacy rows. Callers use it (joined with the
   * matched slug) to render the canonical full name.
   */
  categoryPath: string;
  /** Session slug as actually matched. */
  slug: string;
}

/**
 * Resolve a slash-delimited session name to its row, tolerating both taxonomy
 * eras. The current model (post-#129) treats the first segment as the category
 * and joins the rest into the slug; the pre-#129 model treated the last segment
 * as the slug and everything before it as a (possibly nested) category path.
 *
 * #129 deliberately migrated no existing rows ("only newly-created sessions
 * follow the new rule"), so legacy sessions still live under depth>0 category
 * paths and the flat parse can never name them. We try the flat interpretation
 * first (new rows win) and fall back to the legacy split so `bertrand log`,
 * `stats`, and `archive` can still reach those older sessions.
 */
export function resolveSessionByName(
  name: string,
): ResolvedSession | undefined {
  // Current flat interpretation: first segment = category, rest = slug.
  // parseSessionName validates the segments and throws on a single-segment
  // name, preserving the callers' existing input-validation behavior.
  const flat = parseSessionName(name);
  const flatCategory = getCategoryByPath(flat.categoryPath);
  if (flatCategory) {
    const session = getSessionByCategorySlug(flatCategory.id, flat.slug);
    if (session) {
      return { session, categoryPath: flat.categoryPath, slug: flat.slug };
    }
  }

  // Legacy interpretation: last segment = slug, everything before = category.
  // Skipped for two-segment names, where it's identical to the flat parse.
  const segments = name
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segments.length >= 3) {
    const legacyCategoryPath = segments.slice(0, -1).join("/");
    const legacySlug = segments[segments.length - 1]!;
    const legacyCategory = getCategoryByPath(legacyCategoryPath);
    if (legacyCategory) {
      const session = getSessionByCategorySlug(legacyCategory.id, legacySlug);
      if (session) {
        return { session, categoryPath: legacyCategoryPath, slug: legacySlug };
      }
    }
  }

  return undefined;
}

export function createSession(opts: {
  categoryId: string;
  slug: string;
  name: string;
}) {
  const db = getDb();
  const id = createId();
  return db
    .insert(sessions)
    .values({ id, ...opts })
    .returning()
    .get();
}

export function getSession(
  id: string,
  db: Db = getDb(),
): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, id)).get();
}

export function getSessionByCategorySlug(
  categoryId: string,
  slug: string,
): SessionRow | undefined {
  return getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.categoryId, categoryId), eq(sessions.slug, slug)))
    .get();
}

export function getSessionsByCategory(categoryId: string): SessionRow[] {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.categoryId, categoryId))
    .all();
}

export function getActiveSessions(): SessionWithCategory[] {
  return getDb()
    .select({ session: sessions, categoryPath: categories.path })
    .from(sessions)
    .innerJoin(categories, eq(sessions.categoryId, categories.id))
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

function selectSessions(
  db: Db,
  opts?: { excludeArchived?: boolean },
): SessionWithCategory[] {
  const query = db
    .select({ session: sessions, categoryPath: categories.path })
    .from(sessions)
    .innerJoin(categories, eq(sessions.categoryId, categories.id));

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
}): SessionWithCategory[] {
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
): SessionWithCategory[] {
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
    endedAt: string;
    worktreePath: string | null;
    worktreeBranch: string | null;
  }>
) {
  return getDb()
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

export function setSessionRating(id: string, rating: number | null) {
  return getDb()
    .update(sessions)
    .set({ rating, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function renameSession(id: string, slug: string, name?: string) {
  return getDb()
    .update(sessions)
    .set({ slug, name: name ?? slug, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function moveSession(id: string, categoryId: string) {
  return getDb()
    .update(sessions)
    .set({ categoryId, updatedAt: sql`(datetime('now'))` })
    .where(eq(sessions.id, id))
    .returning()
    .get();
}

export function deleteSession(id: string) {
  return getDb()
    .delete(sessions)
    .where(eq(sessions.id, id))
    .run();
}
