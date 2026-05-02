import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessionStats } from "@/db/schema";

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
    linesAdded: number;
    linesRemoved: number;
    filesTouched: number;
  }
) {
  return getDb()
    .insert(sessionStats)
    .values({
      sessionId,
      ...data,
      updatedAt: sql`(datetime('now'))`,
    })
    .onConflictDoUpdate({
      target: sessionStats.sessionId,
      set: { ...data, updatedAt: sql`(datetime('now'))` },
    })
    .returning()
    .get();
}
