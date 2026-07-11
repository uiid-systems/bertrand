import type { sessions, events, sessionStats } from "./db/schema";

export type SessionRow = typeof sessions.$inferSelect;
export type SessionStatus = SessionRow["status"];

export type EventRow = Omit<typeof events.$inferSelect, "meta"> & {
  meta: Record<string, unknown> | null;
};

export type SessionStatsRow = typeof sessionStats.$inferSelect;

export type SessionWithCategory = {
  session: SessionRow;
  categoryPath: string;
  /**
   * Which project this session belongs to. Present when the row was produced
   * by a cross-project query (the dashboard's multi-project session list);
   * omitted for single-project/active-DB reads where the project is implicit.
   */
  project?: { slug: string; name: string };
};

/**
 * /api/worktrees row: a worktree-bearing session plus the branch git
 * *currently* has checked out. The DB's worktree_branch is a snapshot from
 * EnterWorktree time and goes stale when the worktree switches branches
 * mid-life, so the server re-reads it from git per response.
 */
export type WorktreeSessionRow = SessionWithCategory & {
  branch: string | null;
};

export type EngagementStats = {
  toolUsage: Record<string, number>;
  discardRate: { discarded: number; total: number };
};

export type ArchiveReason = "not-found" | "active" | "already-archived";
export type UnarchiveReason = "not-found" | "not-archived";
export type ArchiveErrorReason = ArchiveReason | UnarchiveReason | "unknown";
