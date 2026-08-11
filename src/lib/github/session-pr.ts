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
   * The session's worktree, when it has one that still exists on disk. Callers
   * pass `null` for a deleted checkout — the branch snapshot below outlives it
   * and is what keeps a finished session's PR visible.
   */
  worktreePath: string | null;
  /** `worktree_branch`: the EnterWorktree-time snapshot the DB holds. */
  worktreeBranch: string | null;
  /** The project's bound repo checkout, absent when the project is unbound. */
  repoPath?: string | undefined;
}

/**
 * The three I/O calls, injected. Each has a real implementation the route
 * wires in; the indirection exists so the decisions in
 * {@link resolveSessionPullRequest} can be tested as decisions.
 */
export interface SessionPrDeps {
  /** The branch a worktree currently has checked out; null when git can't say. */
  readBranch: (worktreePath: string) => Promise<string | null>;
  /** The GitHub repo a path belongs to. */
  resolveRepo: (path: string) => Promise<RepoResolution>;
  /** The PR for a branch — {@link import("./pr").getPRForBranch}. */
  lookupPR: (
    identity: ProviderIdentity,
    branch: string,
  ) => Promise<PullRequestLookup>;
}

/**
 * Which branch to look the PR up by.
 *
 * Git is asked first and the DB snapshot is the fallback, matching how
 * /api/worktrees reports a branch: `worktree_branch` is written once, at
 * EnterWorktree time, so a session that switched branches mid-life would
 * otherwise be shown the PR for the branch it started on.
 *
 * The snapshot still matters — it is the *only* branch left once the worktree
 * is deleted, which is exactly when a session's PR is most worth seeing.
 */
async function resolveBranch(
  source: SessionPrSource,
  deps: SessionPrDeps,
): Promise<string | null> {
  const live = source.worktreePath
    ? await deps.readBranch(source.worktreePath)
    : null;

  const branch = live ?? source.worktreeBranch ?? "";

  // A detached HEAD reads as null and a never-set snapshot as null; either way
  // there is no branch to ask about.
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
  const branch = await resolveBranch(source, deps);

  if (branch === null) {
    return NONE;
  }

  // The worktree resolves to its main checkout, so either path names the same
  // repo. Preferring the worktree keeps the answer right for a session whose
  // project binding is missing, and the binding covers the reverse: a session
  // whose worktree has already been deleted.
  const path = source.worktreePath ?? source.repoPath;

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
