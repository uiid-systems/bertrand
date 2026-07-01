import { eq, and, desc } from "drizzle-orm";
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
}) {
  return getDb()
    .insert(events)
    .values({
      sessionId: opts.sessionId,
      conversationId: opts.conversationId,
      event: opts.event,
      summary: opts.summary,
      meta: normalizeEventMeta(opts.event, opts.meta),
    })
    .returning()
    .get();
}

export function getEventsBySession(
  sessionId: string,
  db: Db = getDb(),
): EventRow[] {
  return db
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
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
    .orderBy(events.createdAt)
    .all() as EventRow[];
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

/**
 * Get the most recent event of a given type for a session, optionally scoped
 * to a single conversation. Used by per-turn captures (assistant-message,
 * etc.) to dedup against what was already recorded — same text → skip the
 * insert.
 *
 * Scope to conversation when meaningful: assistant text "I'm done" appearing
 * in two separate Claude conversations within one bertrand session should
 * land twice, not once.
 */
export function getLatestEventOfType(
  sessionId: string,
  eventType: string,
  conversationId?: string,
): EventRow | undefined {
  const conditions = [
    eq(events.sessionId, sessionId),
    eq(events.event, eventType),
  ];
  if (conversationId) {
    conditions.push(eq(events.conversationId, conversationId));
  }
  return getDb()
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.createdAt))
    .limit(1)
    .get() as EventRow | undefined;
}