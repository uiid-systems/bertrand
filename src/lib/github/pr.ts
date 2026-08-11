/**
 * Finding the pull request for a branch, and the state of its checks.
 *
 * Two decisions shape this module.
 *
 * The first is that **no PR is a normal answer**. Most session branches never
 * get one, so `null` is a success value rather than a failure — a caller that
 * had to catch an error for the common case would end up treating a real
 * outage the same as an ordinary branch.
 *
 * The second is that the checks come from the *same* `gh` call as the PR.
 * `gh pr checks` would be the obvious source and is the wrong one: it reports
 * check state through its exit code — 8 for pending, non-zero for failing —
 * which the transport in `./gh` correctly reads as "the command failed", so a
 * red PR would arrive as an error about `gh` rather than as a red PR. Asking
 * `gh pr list` for `statusCheckRollup` sidesteps that entirely and costs one
 * subprocess instead of two, which is what makes polling affordable.
 */
import { runGhJson } from "./gh";
import { formatIdentity } from "./identity";
import type {
  CheckBucket,
  CheckRollupState,
  ProviderIdentity,
  PullRequest,
  PullRequestCheck,
} from "./types";

import type { GhResult } from "./errors";

export type {
  CheckBucket,
  CheckRollupState,
  PullRequest,
  PullRequestCheck,
} from "./types";

/**
 * A lookup's answer: the PR, or `null` when the branch has none.
 *
 * Reusing {@link GhResult} rather than inventing a three-armed type keeps the
 * failure vocabulary identical to every other GitHub call, so a caller renders
 * "not authenticated" once for all of them.
 */
export type PullRequestLookup = GhResult<PullRequest | null>;

/**
 * How long a successful lookup — including "no PR" — is reused.
 *
 * Matches the positive TTL in `./resolve`, and is chosen for the checks rather
 * than the PR: a title changes rarely, a check flips every few seconds, and the
 * two travel together in one response. Half a minute is short enough that a PR
 * opened by hand shows up while the user is still looking at the dashboard.
 */
const SUCCESS_TTL_MS = 30_000;

/**
 * How long a failure is remembered.
 *
 * Longer than success because the expensive failures are the ones that repeat:
 * a logged-out `gh` fails identically every poll, and a rate limit answers a
 * retry storm by extending itself. Still short enough that `gh auth login`
 * takes effect within about a minute. Absence of the binary needs no handling
 * here — `./gh` already stops spawning a missing `gh` on its own.
 */
const FAILURE_TTL_MS = 60_000;

/**
 * How many PRs to consider for one branch.
 *
 * Normally zero or one, but a branch that was merged and reused has several.
 * Ten is far past that and keeps the response small.
 */
const MAX_MATCHES = 10;

const PR_FIELDS = [
  "number",
  "state",
  "isDraft",
  "title",
  "url",
  "mergeable",
  "headRefName",
  "statusCheckRollup",
].join(",");

/**
 * GitHub's state words, mapped to buckets. Anything absent is `pending`.
 *
 * Falling through to `pending` is deliberate: it is the only bucket that claims
 * nothing. A state GitHub adds later would show as "still running" until this
 * table learns it, which is a stale answer — whereas defaulting to `pass` would
 * be a false green and defaulting to `fail` a false alarm.
 */
const BUCKETS: Record<string, CheckBucket> = {
  SUCCESS: "pass",
  // Neither ran to a real verdict, and neither blocks a merge. They are not
  // `pass`, because nothing was actually checked.
  NEUTRAL: "skipping",
  SKIPPED: "skipping",
  CANCELLED: "cancel",
  FAILURE: "fail",
  ERROR: "fail",
  TIMED_OUT: "fail",
  ACTION_REQUIRED: "fail",
  STARTUP_FAILURE: "fail",
  STALE: "fail",
};

/** A check run that has not finished reports its status, not a conclusion. */
const COMPLETED = "COMPLETED";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Assigns a defined key only when there is a value, to keep results clean. */
function put(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

/**
 * Flatten one `statusCheckRollup` entry.
 *
 * The array is heterogeneous, and that is the whole difficulty: Actions runs
 * arrive as `CheckRun` with `name`/`status`/`conclusion`, while everything
 * integrating over the older commit-status API — Vercel, most deploy bots —
 * arrives as `StatusContext` with `context`/`state` and none of those fields.
 * Reading only the `CheckRun` shape drops the deploy checks silently, which
 * turns a PR that is still deploying into a PR that looks fully green.
 */
function normalizeCheck(entry: unknown): PullRequestCheck | null {
  if (!isRecord(entry)) {
    return null;
  }

  const typename = str(entry.__typename);
  // Prefer the discriminant, but fall back to the shape: a `context` field is
  // only ever present on the commit-status arm.
  const isStatusContext =
    typename === "StatusContext" || (typename === undefined && "context" in entry);

  const name = isStatusContext ? str(entry.context) : str(entry.name);

  const state = isStatusContext
    ? str(entry.state)
    : // A finished run's verdict lives in `conclusion`; a running one has an
      // empty conclusion and only `status` says anything useful.
      str(entry.status) === COMPLETED
      ? str(entry.conclusion)
      : str(entry.status);

  const url = isStatusContext ? str(entry.targetUrl) : str(entry.detailsUrl);

  const check: Record<string, unknown> = {
    // Never drop a nameless check: its bucket still counts toward the verdict,
    // and a vanished failing check reads as a green PR.
    name: name ?? "check",
    state: state ?? "PENDING",
    bucket: BUCKETS[state ?? ""] ?? "pending",
  };

  put(check, "url", url);
  put(check, "workflow", isStatusContext ? undefined : str(entry.workflowName));
  put(check, "startedAt", str(entry.startedAt));
  put(check, "completedAt", isStatusContext ? undefined : str(entry.completedAt));

  return check as unknown as PullRequestCheck;
}

/**
 * The single verdict for a set of checks.
 *
 * Failure outranks pending because a PR with one failed check is already not
 * merging, and waiting for the rest to finish before saying so just delays the
 * news. `cancel` counts as failure for the same reason: a cancelled run
 * produced no green signal, and treating it as neutral would let a PR whose
 * suite someone stopped read as passing.
 */
function rollupOf(checks: PullRequestCheck[]): CheckRollupState {
  if (checks.length === 0) {
    return "none";
  }

  if (checks.some((check) => check.bucket === "fail" || check.bucket === "cancel")) {
    return "fail";
  }

  if (checks.some((check) => check.bucket === "pending")) {
    return "pending";
  }

  return "pass";
}

const PR_STATES = new Set(["OPEN", "CLOSED", "MERGED"]);
const MERGEABLE_STATES = new Set(["MERGEABLE", "CONFLICTING", "UNKNOWN"]);

function normalizePR(row: unknown): PullRequest | null {
  if (!isRecord(row) || typeof row.number !== "number") {
    return null;
  }

  const rollupEntries = Array.isArray(row.statusCheckRollup) ? row.statusCheckRollup : [];
  const checks = rollupEntries
    .map(normalizeCheck)
    .filter((check): check is PullRequestCheck => check !== null);

  const state = str(row.state) ?? "";
  const mergeable = str(row.mergeable) ?? "";

  return {
    number: row.number,
    state: (PR_STATES.has(state) ? state : "CLOSED") as PullRequest["state"],
    isDraft: row.isDraft === true,
    title: str(row.title) ?? "",
    url: str(row.url) ?? "",
    // An unrecognized value means we do not know whether it merges — which is
    // exactly what `UNKNOWN` says.
    mergeable: (MERGEABLE_STATES.has(mergeable)
      ? mergeable
      : "UNKNOWN") as PullRequest["mergeable"],
    headRefName: str(row.headRefName) ?? "",
    checks,
    rollup: rollupOf(checks),
  };
}

/**
 * Which PR to report when a branch matches several.
 *
 * An open PR always wins: a branch that was merged and then reused has an old
 * merged PR and a live one, and the live one is what the user is working on.
 * Otherwise the newest, which is the order `gh` already returns.
 */
function pickPR(rows: unknown[]): PullRequest | null {
  const prs = rows
    .map(normalizePR)
    .filter((pr): pr is PullRequest => pr !== null);

  return prs.find((pr) => pr.state === "OPEN") ?? prs[0] ?? null;
}

async function fetchPR(
  identity: ProviderIdentity,
  branch: string,
): Promise<PullRequestLookup> {
  const result = await runGhJson<unknown>(
    [
      "pr",
      "list",
      // Only `owner/repo`, never `host/owner/repo`, even on enterprise. The
      // destination is set through `GH_HOST` by the transport, which refuses
      // hosts this machine no longer declares; naming the host here as well
      // would give the same decision a second, ungated route in.
      "--repo",
      `${identity.owner}/${identity.repo}`,
      "--head",
      branch,
      // Merged and closed PRs are part of the answer. A session whose work
      // landed should say "merged", not "no pull request".
      "--state",
      "all",
      "--limit",
      String(MAX_MATCHES),
      "--json",
      PR_FIELDS,
    ],
    identity.host === undefined ? {} : { host: identity.host },
  );

  if (!result.ok) {
    return result;
  }

  // An empty array is the ordinary "this branch has no PR" answer, and is what
  // `gh` returns — with exit 0 — for the majority of branches.
  return { ok: true, value: Array.isArray(result.value) ? pickPR(result.value) : null };
}

interface CacheEntry {
  result: PullRequestLookup;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Lookups that have started but not settled, keyed like the cache. The
 * dashboard polls every visible session, so without this a single render
 * fans out into one `gh` process per session for the same branch.
 */
const inFlight = new Map<string, Promise<PullRequestLookup>>();

let now: () => number = Date.now;

function cacheKey(identity: ProviderIdentity, branch: string): string {
  // The identity is lowercased because GitHub treats owner and repo
  // case-insensitively, so `Acme/Bertrand` and `acme/bertrand` must share an
  // entry. The branch is not: git refs are case-sensitive, and folding them
  // would serve one branch's PR for a different branch.
  return `${formatIdentity(identity).toLowerCase()}#${branch}`;
}

/**
 * The pull request for `branch`, or `null` when it has none.
 *
 * Never throws: every failure arrives as a typed {@link GhResult}, because the
 * dashboard asks this on a poll and an exception there blanks a panel over a
 * rate limit that clears itself.
 *
 * Results are TTL-cached and concurrent callers are coalesced, so polling N
 * sessions costs one `gh` process per branch per window rather than one per
 * render.
 */
export function getPRForBranch(
  identity: ProviderIdentity,
  branch: string,
): Promise<PullRequestLookup> {
  // A session with no branch yet must not reach `gh`. `--head ""` is not an
  // empty filter but no filter at all, so it would answer with the repo's most
  // recent PR — attaching some unrelated PR to the session.
  if (branch.trim() === "") {
    return Promise.resolve({ ok: true, value: null });
  }

  const key = cacheKey(identity, branch);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now()) {
    return Promise.resolve(cached.result);
  }

  const pending = inFlight.get(key);

  if (pending) {
    return pending;
  }

  const promise = fetchPR(identity, branch)
    .then((result) => {
      const ttl = result.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
      cache.set(key, { result, expiresAt: now() + ttl });
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);

  return promise;
}

/**
 * The checks on the pull request for `branch`.
 *
 * `null` when the branch has no PR, which is not the same as `[]` — an empty
 * array means a PR exists and nothing is checking it.
 *
 * This reads through {@link getPRForBranch}, so it costs no extra `gh` process:
 * the checks arrive in the same response as the PR, and a caller that wants
 * both gets one subprocess rather than two.
 */
export async function getPRChecks(
  identity: ProviderIdentity,
  branch: string,
): Promise<GhResult<PullRequestCheck[] | null>> {
  const result = await getPRForBranch(identity, branch);

  if (!result.ok) {
    return result;
  }

  return { ok: true, value: result.value ? result.value.checks : null };
}

/** Drop every cached and in-flight lookup. */
export function _resetPRCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Swap the TTL clock, so expiry is testable without waiting. */
export function _setClock(clock: (() => number) | null): void {
  now = clock ?? Date.now;
}
