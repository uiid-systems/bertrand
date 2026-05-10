import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";
import { normalizeEventMeta } from "@/lib/markdown";

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

export function getEventsBySession(sessionId: string) {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(events.createdAt, events.id)
    .all();
}

export function getEventsByConversation(conversationId: string) {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.conversationId, conversationId))
    .orderBy(events.createdAt)
    .all();
}

export function getEventsByType(sessionId: string, eventType: string) {
  return getDb()
    .select()
    .from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.event, eventType)))
    .orderBy(events.createdAt)
    .all();
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

export function getLatestRecaps(): Record<
  string,
  { recap: string; createdAt: string }
> {
  const rows = getDb()
    .select({
      sessionId: events.sessionId,
      meta: events.meta,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.event, "session.recap"))
    .orderBy(desc(events.createdAt))
    .all();

  const result: Record<string, { recap: string; createdAt: string }> = {};
  for (const row of rows) {
    if (result[row.sessionId]) continue;
    const meta = row.meta as Record<string, unknown> | null;
    const recap = typeof meta?.recap === "string" ? meta.recap : null;
    if (!recap) continue;
    result[row.sessionId] = { recap, createdAt: row.createdAt };
  }
  return result;
}
