import { eq, and, gt, desc } from "drizzle-orm";
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
  return getDb()
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.event, eventType)))
    .orderBy(edge === "first" ? events.createdAt : desc(events.createdAt), events.id)
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
