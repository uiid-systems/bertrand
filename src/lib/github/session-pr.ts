/**
 * Turning a *session* into a pull request.
 *
 * `./pr` answers "what is the PR for this branch, in this repo". Getting from
 * a session row to those two arguments is the part with the judgement calls,
 * and it lives here rather than in the route so it can be tested without a
 * server, a git checkout, or a `gh` on PATH.
 *
 * The rule the whole module serves: **a session with no answer renders
 * nothing**. Every branch below that cannot name a PR returns `none`, and the
 * one arm that returns `unavailable` is reserved for the single case where
 * bertrand actually asked GitHub and GitHub did not answer.
 */
import type { SessionPullRequest } from "@/types";

import type { PullRequestLookup } from "./pr";
import type { RepoResolution } from "./resolve";
import type { ProviderIdentity } from "./types";

const NONE: SessionPullRequest = { status: "none" };

/** What a session row contributes to the lookup. */
export interface SessionPrSource {
  /**
   * The branch this session worked on, as recorded on its row.
   *
   * Written at every session start from the cwd (ELKY-177). It replaced a pair
   * of worktree fields that were the only branch source there had ever been —
   * and which, measured across 49 sessions, were set on exactly the 3 that
   * used a worktree, leaving the card dark for the other 46.
   *
   * Still null for two ordinary reasons: sessions that predate the column, and
   * sessions whose cwd was not in a git repo.
   */
  branch: string | null;
  /** The project's bound repo checkout, absent when the project is unbound. */
  repoPath?: string | undefined;
}

/**
 * The three I/O calls, injected. Each has a real implementation the route
 * wires in; the indirection exists so the decisions in
 * {@link resolveSessionPullRequest} can be tested as decisions.
 */
export interface SessionPrDeps {
  /** The GitHub repo a path belongs to. */
  resolveRepo: (path: string) => Promise<RepoResolution>;
  /** The PR for a branch — {@link import("./pr").getPRForBranch}. */
  lookupPR: (
    identity: ProviderIdentity,
    branch: string,
  ) => Promise<PullRequestLookup>;
}

/**
 * The branch a session's PR is looked up by.
 *
 * A blank or absent value means there is nothing to ask GitHub about — a
 * pre-ELKY-177 session, or one that ran outside a repo. Blank is folded in
 * with absent so a row that somehow stored `""` cannot become a lookup for
 * the empty branch.
 */
function resolveBranch(source: SessionPrSource): string | null {
  const branch = source.branch ?? "";
  return branch.trim() === "" ? null : branch;
}

/**
 * The pull request for a session's branch, in the shape the dashboard renders.
 *
 * Never throws and never reports a repo problem as a GitHub problem: a
 * checkout that is not a git repo, has no `origin`, or points somewhere other
 * than GitHub is a permanent fact about that project, not an outage. Those all
 * answer `none`, because the alternative — a permanent "PR status unavailable"
 * line on every session in a non-GitHub project — is the empty scaffolding
 * this feature is supposed to avoid.
 */
export async function resolveSessionPullRequest(
  source: SessionPrSource,
  deps: SessionPrDeps,
): Promise<SessionPullRequest> {
  const branch = resolveBranch(source);

  if (branch === null) {
    return NONE;
  }

  // The project's bound checkout is the only path left; it names the repo the
  // branch belongs to.
  const path = source.repoPath;

  if (!path) {
    return NONE;
  }

  const repo = await deps.resolveRepo(path);

  if (!repo.ok) {
    return NONE;
  }

  const lookup = await deps.lookupPR(repo.repo.provider, branch);

  if (!lookup.ok) {
    return {
      status: "unavailable",
      reason: lookup.reason,
      message: lookup.message,
    };
  }

  return lookup.value
    ? { status: "ok", pullRequest: lookup.value }
    : NONE;
}
