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
    diffSource?: "events" | "git";
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
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

/**
 * Write git-derived diff counters onto an existing stats row, marking them as
 * such. Only the three counters and their source move — everything else on the
 * row is event-derived and stays where the last full computation left it.
 *
 * Separate from `upsertSessionStats` because the two writes answer to different
 * lifetimes. The full computation can be re-run from immutable events at any
 * point; this one could only be taken while a session's worktree was on disk,
 * at moments that had nothing to do with a session ending.
 *
 * Nothing calls it since the worktree teardown. The rows it already wrote are
 * permanent record, though — `withStoredGitDiffs` still serves them, so a
 * session that had a worktree keeps its branch-accurate counters.
 *
 * Returns the updated row, or `undefined` when the session has no stats row
 * yet — the caller is expected to have materialized one first.
 */
export function snapshotDiffStats(
  sessionId: string,
  diff: { linesAdded: number; linesRemoved: number; filesTouched: number },
  db: Db = getDb(),
): SessionStatsRow | undefined {
  return db
    .update(sessionStats)
    .set({ ...diff, diffSource: "git", updatedAt: sql`(datetime('now'))` })
    .where(eq(sessionStats.sessionId, sessionId))
    .returning()
    .get();
}
