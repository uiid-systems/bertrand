export type {
  SessionRow,
  SessionStatus,
  SessionWithCategory,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  ArchiveReason,
  UnarchiveReason,
  ArchiveErrorReason,
  RateReason,
  DiscardReason,
  SessionActionErrorReason,
  ChangedFile,
  ProjectRepoView,
  ProjectSummary,
  ActiveProjectMeta,
  SessionPullRequest,
  PullRequest,
  PullRequestCheck,
  CheckBucket,
  CheckRollupState,
  GhFailureReason,
} from "@/types"

// Shapes the root `src` owns but `@/types` doesn't re-export. `@/*` maps to
// the root `src`, and this file is in the dashboard's TypeScript program, so
// point only at leaf type modules: `import type` erases the runtime import but
// the type graph still resolves, and naming a module that does I/O would make
// this build depend on its whole subtree. `src/types-boundary.test.ts` enforces
// this — see the note there.
export type { WorkspaceServerStatus } from "@/lib/workspace/types"
