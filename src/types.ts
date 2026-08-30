/**
 * Shared API/domain shapes. The dashboard's TypeScript program includes this
 * file (`dashboard/tsconfig.json`), so every module reachable from here has to
 * resolve under the dashboard's build too.
 *
 * `import type` is not enough to keep that safe on its own — it erases the
 * runtime import but the *type* graph still has to resolve, so pointing at a
 * module that does I/O makes the dashboard build depend on everything behind
 * it. Import only from leaf type modules — a `types.ts` beside the module
 * that owns the shape — never from a module that imports `fs`, `os`, `path`
 * or `bun`. `types-boundary.test.ts` enforces this.
 */
import type { sessions, events, sessionStats } from "./db/schema";
import type { ProjectRepo } from "./lib/projects/types";
import type { GhFailureReason } from "./lib/github/errors";
import type { PullRequest } from "./lib/github/types";

export type { ChangedFile } from "./lib/git-types";
export type {
  CheckBucket,
  CheckRollupState,
  PullRequest,
  PullRequestCheck,
} from "./lib/github/types";
export type { GhFailureReason } from "./lib/github/errors";

export type SessionRow = typeof sessions.$inferSelect;
export type SessionStatus = SessionRow["status"];

export type EventRow = Omit<typeof events.$inferSelect, "meta"> & {
  meta: Record<string, unknown> | null;
};

export type SessionStatsRow = typeof sessionStats.$inferSelect;

export type SessionListRow = {
  session: SessionRow;
  /**
   * Which project this session belongs to. Present when the row was produced
   * by a cross-project query (the dashboard's multi-project session list);
   * omitted for single-project/active-DB reads where the project is implicit.
   */
  project?: { slug: string; name: string };
};

/**
 * /api/github/:sessionId/pr — the pull request for a session's branch.
 *
 * Three arms rather than a nullable PR, because the UI draws three different
 * things and collapsing any two of them lies. `none` is the common case and
 * the one that must render *nothing*: most session branches never get a PR,
 * and an empty "no pull request" panel on every session is scaffolding, not
 * information. `unavailable` means bertrand asked GitHub and GitHub did not
 * answer — the PR may well exist, so this must never render as "no PR", and
 * equally must never render as an error: a rate limit that clears itself is
 * not something to alarm anyone about.
 *
 * The failure carries `reason` alongside `message` so the dashboard can decide
 * whether a failure is even worth mentioning — a machine with no `gh` at all
 * has no PR feature to report on, which is silence rather than a warning.
 */
export type SessionPullRequest =
  | { status: "none" }
  | { status: "unavailable"; reason: GhFailureReason; message: string }
  | { status: "ok"; pullRequest: PullRequest };

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
export type ProjectRepoView = ProjectRepo & {
  label: string;
  /**
   * False for a binding whose host this machine no longer declares as GitHub
   * Enterprise Server. The binding is still shown — dropping a project's repo
   * out from under it would be worse — but a host bertrand cannot vouch for
   * should not render as one it can.
   */
  hostTrusted: boolean;
};

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
