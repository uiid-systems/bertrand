export type {
  SessionRow,
  SessionStatus,
  SessionWithCategory,
  WorktreeSessionRow,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  ArchiveReason,
  UnarchiveReason,
  ArchiveErrorReason,
  ChangedFile,
  WorktreeChangedFiles,
} from "@/types"

// Type-only — erased at build, so this never pulls the workspace runtime
// (child_process/fs) into the dashboard bundle. `@/*` maps to the root `src`.
export type { WorkspaceServerStatus } from "@/lib/workspace/server"
export type { RemoveWorktreeReason } from "@/lib/worktree-remove"
