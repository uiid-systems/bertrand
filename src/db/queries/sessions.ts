import { eq, and, inArray, isNotNull, lt, ne, sql, desc } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { sessions, events } from "@/db/schema";
import { createId, placeholderSlug } from "@/lib/id";
import {
  getSessionByAlias,
  isAliasTakenByOtherSession,
} from "@/db/queries/session-aliases";
import { parseSessionName } from "@/lib/parse-session-name";
import type { SessionKey } from "@/lib/session-key";
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

/**
 * Everything a new session row can be given.
 *
 * Extends `Partial<SessionKey>` rather than restating its four fields, so the
 * columns cannot drift from what `deriveSessionKey` actually produces — the
 * contract module (`@/lib/session-key`) is the single definition of the shape
 * and this is storage for it. Every key field is optional *and* nullable
 * because a cwd that resolves to nothing is ordinary: bertrand records
 * sessions outside git, and such a session is ungrouped, not rejected.
 */
export interface CreateSessionOpts extends Partial<SessionKey> {
  slug: string;
  /**
   * Display name (defaults to the slug). On a 'derived' row it may only
   * repeat the slug: derivation writes name and slug together, so a display
   * name of its own would be silently replaced at the first pause.
   */
  name?: string;
  /** Omitted means 'manual' — a name the human typed, never re-derived. */
  nameSource?: SessionRow["nameSource"];
  /**
   * `groupKey(key)` for the `SessionKey` above, computed by the caller rather
   * than here: the caller has already derived the key and the two must agree,
   * and recomputing it in the query layer would put a second, drifting copy of
   * the grouping rule downstream of the one module that owns it.
   */
  groupKey?: string | null;
}

export function createSession(opts: CreateSessionOpts) {
  if (
    opts.nameSource === "derived" &&
    opts.name !== undefined &&
    opts.name !== opts.slug
  ) {
    throw new Error(
      "A derived session cannot carry its own display name — it is named at pause.",
    );
  }
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
 * The session that currently *is* the unit of work `groupKey` names, or
 * undefined if nothing is working on it.
 *
 * This is the query that turns repeated claude runs on one task into
 * conversations of a single session. Before it, `adopt` minted a fresh session
 * per run, which is why `session` sat 1:1 with `conversation` and the sibling
 * summaries had nothing to group. A run whose cwd derives to a key already
 * open attaches to that row instead.
 *
 * Ordered by `updatedAt` — the last time the session did something, which is
 * what "still the live one" means — and not by `startedAt`, which would keep
 * electing whichever row was created first no matter how long ago it went
 * quiet. `updatedAt` is trustworthy here precisely because the two metadata
 * writers (`setSessionSummary`, `setDerivedSessionSlug`) deliberately do not
 * bump it, so it tracks activity rather than bookkeeping.
 *
 * Archived rows are excluded, and that exclusion is the escape hatch for the
 * whole scheme: archiving is how the user says "this task is done". A later run
 * on the same branch — a follow-up fix, a review round, a revert — is new work
 * that deserves its own session rather than reopening one the user retired.
 * Without the exclusion a branch that lives forever (`main`) could never start
 * a second session. Every other status, `paused` included, is mid-session:
 * the Stop hook pauses at the end of every turn while claude keeps running.
 *
 * Not a unique-index lookup: the index on `group_key` is deliberately
 * non-unique because one key legitimately accumulates rows over time as
 * sessions are archived, and this query is what picks the one that counts.
 */
export function findOpenSessionByGroupKey(
  groupKey: string,
  db: Db = getDb(),
): SessionRow | undefined {
  return db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.groupKey, groupKey), ne(sessions.status, "archived")),
    )
    .orderBy(desc(sessions.updatedAt))
    .limit(1)
    .get();
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
 * Sessions that still name a process, and so might need finalizing.
 *
 * Deliberately wider than {@link LIVE_STATUSES}. `paused` is not a terminal
 * state — the Stop hook sets it at the end of every turn that doesn't call
 * AskUserQuestion, while claude keeps running — so a paused row with a pid is
 * an ordinary mid-session state, not a finished session. What makes it
 * *finished* is the process being gone, which is the caller's check, not this
 * query's.
 *
 * Finalizing nulls the pid, so a session that already ended can never come
 * back through here. Archived rows are excluded outright: they were retired
 * on purpose and must not be reanimated to emit an ended event.
 */
export function getRecoverableSessions(): SessionListRow[] {
  return getDb()
    .select({ session: sessions })
    .from(sessions)
    .where(and(isNotNull(sessions.pid), ne(sessions.status, "archived")))
    .all();
}

/**
 * How many sessions are currently live — running, or halted awaiting the user.
 * A cheap COUNT rather than materializing the rows, since every caller so far
 * wants the number and not the sessions.
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
    // Nullable: re-attaching a finalized session (`bertrand adopt` on a resumed
    // conversation) has to clear it, or the row reads as finished while it runs.
    endedAt: string | null;
    branch: string | null;
    // The derived grouping key, refreshed on every attach rather than written
    // once. A resumed conversation can come back in a different worktree or on
    // a renamed branch, and a session that reports where it *used* to run is
    // worse than one that reports nothing — so `adopt` re-derives the whole key
    // and writes it through here, not just the fields it expects to differ.
    worktreeRoot: string | null;
    mainCheckout: string | null;
    repo: string | null;
    groupKey: string | null;
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
 * Whether any *other* session holds `slug`. The slug is the session's whole
 * identity (unique index `sessions_slug`), so this is the duplicate check for
 * both the derivation engine and `bertrand rename`.
 *
 * `sessionId` null means "nothing is exempt" — the caller has no row yet.
 */
export function isSlugTakenByOtherSession(
  slug: string,
  sessionId: string | null,
  db: Db = getDb(),
): boolean {
  const row = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.slug, slug),
        sessionId === null ? undefined : ne(sessions.id, sessionId),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

/**
 * Whether `name` is another session's identity — its current slug, OR a
 * retired name still resolving through `session_aliases`. Claiming a name an
 * alias holds shadows it permanently (`resolveSessionByName` tries slugs
 * first), so every path that takes a name checks both halves, not just the
 * slug table.
 */
export function isNameTakenByOtherSession(
  name: string,
  sessionId: string | null,
  db: Db = getDb(),
): boolean {
  return (
    isSlugTakenByOtherSession(name, sessionId, db) ||
    isAliasTakenByOtherSession(name, sessionId, db)
  );
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
 * Unguarded by design — callers decide whether deletion is allowed. Nothing on
 * a user-facing path calls this any more: `discardSession` was its only caller
 * and went with the TUI exit screen it served, leaving archive as the way to
 * put a session away. Kept as the primitive the schema's cascade behavior is
 * tested through; guard on liveness yourself before reaching for it again.
 */
export function deleteSession(id: string, db: Db = getDb()) {
  return db
    .delete(sessions)
    .where(eq(sessions.id, id))
    .run();
}

/**
 * Hard-delete every session created before `iso`, with its entire history.
 *
 * This is the one bulk destructive operation in the codebase, and it exists
 * because the grouping teardown left a cohort of sessions filed under a
 * dimension that no longer exists — rows whose recorded project was, measurably,
 * the wrong one for 5 of the 8 sessions that mattered. Rather than backfill a
 * grouping key onto history nobody will read, the user declared everything
 * before the cutover stale and chose to drop it.
 *
 * `iso` is compared against `created_at`, which is a `datetime('now')` string
 * (`YYYY-MM-DD HH:MM:SS`, UTC) — SQLite has no date type, so this is a plain
 * lexicographic string comparison and only sorts correctly for that same
 * format. Pass `"2026-09-02"` or `"2026-09-02 00:00:00"`, never an RFC-3339
 * string with a `T` or a `Z`: `"2026-09-02T00:00:00Z" > "2026-09-02 23:59:59"`
 * lexicographically, so the `T` form would silently take a whole extra day.
 *
 * Events go first and explicitly, ahead of the session rows whose cascade
 * would take them anyway. `events.conversation_id` references
 * `conversations.id` with ON DELETE NO ACTION, so deleting a session leans on
 * SQLite's cascade *ordering* — the events must be gone before the
 * conversations they point at — and that order is not something SQLite
 * documents. Deleting events up front makes the outcome independent of it.
 * Everything else (`conversations`, `session_stats`, `session_labels`,
 * `session_aliases`) declares ON DELETE CASCADE against `sessions.id` and
 * `PRAGMA foreign_keys = ON` is set in client.ts, so the session delete carries
 * them.
 *
 * `ingest_cursors` is deliberately untouched: it is keyed by transcript path,
 * has no session column, and records how far bertrand has read a file on this
 * machine. Its rows are cheap, and clearing one would invite a purged
 * transcript to be re-ingested from byte zero.
 *
 * Wrapped in a transaction so a purge either completes or leaves the database
 * exactly as it was; the counts are taken inside it, so they describe what was
 * actually removed.
 */
export function purgeSessionsBefore(
  iso: string,
  db: Db = getDb(),
): { sessions: number; events: number } {
  return db.transaction((tx) => {
    // A fresh sub-select each time rather than one reused builder: this lands
    // as `session_id IN (SELECT id FROM sessions WHERE created_at < ?)`, which
    // is also why the ids are never materialized into a parameter list — a
    // purge can span thousands of rows and SQLite caps bound parameters.
    const doomed = () =>
      tx.select({ id: sessions.id }).from(sessions).where(lt(sessions.createdAt, iso));

    const sessionCount =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(sessions)
        .where(lt(sessions.createdAt, iso))
        .get()?.n ?? 0;

    if (sessionCount === 0) return { sessions: 0, events: 0 };

    const eventCount =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(events)
        .where(inArray(events.sessionId, doomed()))
        .get()?.n ?? 0;

    tx.delete(events).where(inArray(events.sessionId, doomed())).run();
    tx.delete(sessions).where(lt(sessions.createdAt, iso)).run();

    return { sessions: sessionCount, events: eventCount };
  });
}
