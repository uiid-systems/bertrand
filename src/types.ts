import type { sessions, events, sessionStats } from "./db/schema";
// Type-only — erased at build; keeps this barrel free of runtime imports.
import type { WorkspaceServerStatus } from "./lib/workspace/server";
import type { ProjectRepo } from "./lib/projects/registry";

export type { ChangedFile, WorktreeChangedFiles } from "./lib/git";

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
  /**
   * Dev-server preview state for this worktree, resolved in the same
   * /api/worktrees scan — one poll serves the whole worktree UI instead of a
   * separate /status request re-running the session scan.
   */
  status: WorkspaceServerStatus;
};

export type EngagementStats = {
  toolUsage: Record<string, number>;
  discardRate: { discarded: number; total: number };
};

/**
 * A project's repo binding as the API serves it: the stored binding plus a
 * display `label` the server formats.
 *
 * The label is computed server-side on purpose. Rendering `owner/repo` looks
 * trivial until GitHub Enterprise, where the host has to be prefixed —
 * `formatIdentity` owns that rule, and the dashboard can't call it (it takes
 * *types* from `src`, never runtime code, since there's no `@/` alias in the
 * Vite build). Sending the formatted string keeps the rule in one place.
 */
export type ProjectRepoView = ProjectRepo & { label: string };

/**
 * One row of /api/projects.
 *
 * `repo` is explicitly `null` when unbound rather than omitted: an absent key
 * would be indistinguishable from a server too old to send it, and the
 * dashboard renders those two cases differently.
 */
export type ProjectSummary = {
  slug: string;
  name: string;
  /** True for the registry's active project — the CLI's write target. */
  active: boolean;
  lastUsedAt: string;
  /** Count of currently live (active/waiting) sessions in this project. */
  liveCount: number;
  repo: ProjectRepoView | null;
};

/** /api/active-project — the registry's current write target. */
export type ActiveProjectMeta = {
  slug: string;
  name: string;
  repo: ProjectRepoView | null;
};

export type ArchiveReason = "not-found" | "active" | "already-archived";
export type UnarchiveReason = "not-found" | "not-archived";
export type ArchiveErrorReason = ArchiveReason | UnarchiveReason | "unknown";

export type RateReason = "not-found" | "out-of-range";
export type DiscardReason = "not-found" | "active";
export type SessionActionErrorReason =
  | RateReason
  | DiscardReason
  | "unknown";
