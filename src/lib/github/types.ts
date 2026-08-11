/**
 * Pure data shapes for the GitHub layer.
 *
 * A leaf on purpose: this module imports nothing, so anything that needs only
 * the *shape* of a repo identity can reach it without dragging in the parser
 * (`identity.ts`) or anything below it. `src/types.ts` — the barrel the
 * dashboard's TypeScript program reads — depends on this file transitively,
 * and its build must never end up resolving `fs`/`os`/`path` to typecheck a
 * type it erases. Keep this module import-free.
 */

/**
 * Portable identity of a GitHub repository. Portable is the point: bertrand
 * syncs projects across machines, where `owner/repo` travels and a checkout
 * path does not.
 */
export interface ProviderIdentity {
  /** Discriminant; other forges would be additive. */
  provider: "github";
  owner: string;
  repo: string;
  /** Undefined means github.com. Set only for GitHub Enterprise Server. */
  host?: string;
}

/**
 * A check's outcome, collapsed to the five states a UI has to draw.
 *
 * GitHub reports checks in two unrelated vocabularies — Actions check runs have
 * a status and a conclusion, older commit statuses have a single state — and
 * neither is what a badge needs. These names match the buckets `gh pr checks`
 * prints, so a user comparing the dashboard against the CLI sees one story.
 */
export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel";

/** One check on a pull request's head commit, in a single normalized shape. */
export interface PullRequestCheck {
  /** The check run's name, or the commit status's context. */
  name: string;
  bucket: CheckBucket;
  /**
   * GitHub's own state word — a conclusion for a finished check run, a status
   * for a running one, a state for a commit status. Kept because it is more
   * specific than the bucket and is what a user would see on GitHub itself.
   */
  state: string;
  /** Where a human goes to read the run. Absent when GitHub reported none. */
  url?: string;
  /** The workflow a check run belongs to. Absent for commit statuses. */
  workflow?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * The verdict across every check on a PR.
 *
 * `none` is distinct from `pass` on purpose: a PR with no checks configured has
 * not succeeded at anything, and rendering it green would claim a guarantee no
 * one made.
 */
export type CheckRollupState = "pass" | "fail" | "pending" | "none";

/** A pull request, in the shape bertrand shows and stores. */
export interface PullRequest {
  number: number;
  /**
   * These three are the whole of GitHub's `PullRequestState`. Like everything
   * else parsed out of `gh`, the union is a claim about what the CLI returns
   * rather than a checked fact.
   */
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  title: string;
  url: string;
  /**
   * `UNKNOWN` is common and is not an error: GitHub computes mergeability
   * lazily, so a PR nobody has opened recently reports `UNKNOWN` until the
   * background job runs. Treat it as "ask again later", never as "conflicts".
   */
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** The branch the PR was opened from — the one that matched the lookup. */
  headRefName: string;
  checks: PullRequestCheck[];
  /** Summary of {@link checks}, precomputed so callers agree on the verdict. */
  rollup: CheckRollupState;
}
