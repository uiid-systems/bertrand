import { eq } from "drizzle-orm";
import { getDb } from "../client.ts";
import { sessionStats } from "../schema.ts";

export function getSessionStats(sessionId: string) {
  return getDb()
    .select()
    .from(sessionStats)
    .where(eq(sessionStats.sessionId, sessionId))
    .get();
}

export function upsertSessionStats(
  sessionId: string,
  data: {
    eventCount: number;
    conversationCount: number;
    interactionCount: number;
    prCount: number;
    claudeWorkS: number;
    userWaitS: number;
    activePct: number;
    durationS: number;
  }
) {
  return getDb()
    .insert(sessionStats)
    .values({
      sessionId,
      ...data,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: sessionStats.sessionId,
      set: { ...data, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}
