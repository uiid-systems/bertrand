import { eq, and, gt, desc, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { events } from "@/db/schema";
import { normalizeEventMeta } from "@/lib/markdown";
import type { EventRow } from "@/types";

export function insertEvent(opts: {
  sessionId: string;
  conversationId?: string;
  event: string;
  summary?: string;
  meta?: Record<string, unknown>;
  /**
   * Override the row's createdAt (sqlite `datetime('now')` format). Transcript
   * ingestion passes the entry's own timestamp so assistant messages sort
   * where they were *said*, not where the ingest tick happened to run.
   */
  createdAt?: string;
}, db: Db = getDb()) {
  return db
    .insert(events)
    .values({
      sessionId: opts.sessionId,
      conversationId: opts.conversationId,
      event: opts.event,
      summary: opts.summary,
      meta: normalizeEventMeta(opts.event, opts.meta),
      createdAt: opts.createdAt,
    })
    .returning()
    .get();
}

export function getEventsBySession(
  sessionId: string,
  db: Db = getDb(),
  opts?: {
    /**
     * Only rows with id > sinceId. Events are append-only (never updated or
     * deleted), so the max id a client has seen is a complete cursor — the
     * dashboard polls with it to fetch just the delta instead of the full
     * timeline. Note: ordering is by createdAt (transcript ingestion can
     * backdate rows), so new ids don't necessarily sort last; consumers must
     * merge-and-resort, not blindly append.
     */
    sinceId?: number;
  },
): EventRow[] {
  const bySession = eq(events.sessionId, sessionId);
  return db
    .select()
    .from(events)
    .where(
      opts?.sinceId != null
        ? and(bySession, gt(events.id, opts.sinceId))
        : bySession,
    )
    .orderBy(events.createdAt, events.id)
    .all() as EventRow[];
}

/**
 * Highest event id for a session, 0 when it has none. Events are append-only,
 * so this single integer is a complete change token: equal max ids mean the
 * session's event log is byte-for-byte identical. The dashboard's live-stats
 * path uses it to skip recomputing over unchanged logs.
 */
export function getMaxEventId(sessionId: string, db: Db = getDb()): number {
  const row = db
    .select({ maxId: sql<number | null>`max(${events.id})` })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .get();
  return row?.maxId ?? 0;
}

/**
 * When a session last recorded anything, in whatever shape the row was written
 * in — undefined for a session with no events.
 *
 * `max()` rather than an ordered read: transcript ingestion backdates rows, so
 * the highest id is not necessarily the latest timestamp. Mixed formats sort
 * correctly here because both are UTC and " " sorts before "T", so a
 * `datetime('now')` row and an ISO row for the same second stay in write order.
 *
 * Recovery reads this as its stand-in for "when claude exited". Nothing was
 * watching the process, so the last thing we wrote down is the best evidence
 * available — and it is bounded by the truth, unlike the sweep's own clock.
 */
export function getLastEventAt(
  sessionId: string,
  db: Db = getDb(),
): string | undefined {
  const row = db
    .select({ last: sql<string | null>`max(${events.createdAt})` })
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .get();
  return row?.last ?? undefined;
}

export function getEventsByConversation(conversationId: string): EventRow[] {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.conversationId, conversationId))
    .orderBy(events.createdAt)
    .all() as EventRow[];
}

export function getEventsByType(
  sessionId: string,
  eventType: string,
  db: Db = getDb(),
): EventRow[] {
  return db
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.event, eventType)))
    // id tiebreak: createdAt has one-second resolution, so same-second rows
    // must fall back to insertion order to stay deterministic.
    .orderBy(events.createdAt, events.id)
    .all() as EventRow[];
}

/** First or last event of a given type in a session, by createdAt. */
export function getEdgeEventOfType(
  sessionId: string,
  eventType: string,
  edge: "first" | "last",
): EventRow | undefined {
  // `id` breaks ties in the same direction as the timestamp. `created_at` has
  // one-second granularity, so two events of the same type inside one second
  // are routinely tied — and an ascending tiebreak under a descending sort
  // would return the *earliest* of them for edge "last", which is the opposite
  // of what was asked for.
  return getDb()
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.event, eventType)))
    .orderBy(
      ...(edge === "first"
        ? [events.createdAt, events.id]
        : [desc(events.createdAt), desc(events.id)]),
    )
    .limit(1)
    .get() as EventRow | undefined;
}

export function getLatestEvent(sessionId: string) {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(desc(events.createdAt))
    .limit(1)
    .get();
}
