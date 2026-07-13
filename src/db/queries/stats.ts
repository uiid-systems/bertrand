import { eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { sessionStats } from "@/db/schema";
import type { SessionStatsRow } from "@/types";

export function getSessionStats(
  sessionId: string,
  db: Db = getDb(),
): SessionStatsRow | undefined {
  return db
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
    claudeWorkS: number;
    userWaitS: number;
    activePct: number;
    durationS: number;
    linesAdded: number;
    linesRemoved: number;
    filesTouched: number;
  },
  db: Db = getDb(),
) {
  return db
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
