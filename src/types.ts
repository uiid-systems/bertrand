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

/**
 * A session as every list endpoint serves it.
 *
 * There is no sibling `project` field any more, and nothing replaced it: the
 * grouping dimension is now four columns *on the session itself* (`repo`,
 * `branch`, `groupKey`, `worktreeRoot`), derived from its cwd at start and
 * inferred into `SessionRow` straight from the schema. A client groups by
 * `row.session.repo` and needs no second request and no registry to join
 * against.
 *
 * The wrapper stays a wrapper rather than collapsing to `SessionRow`, because
 * endpoints do decorate it — and a one-field object is a cheaper place to add
 * the next decoration than a breaking change to every caller.
 */
export type SessionListRow = {
  session: SessionRow;
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

export type ArchiveReason = "not-found" | "active" | "already-archived";
export type UnarchiveReason = "not-found" | "not-archived";
export type ArchiveErrorReason = ArchiveReason | UnarchiveReason | "unknown";

export type DiscardReason = "not-found" | "active";
export type SessionActionErrorReason = DiscardReason | "unknown";
