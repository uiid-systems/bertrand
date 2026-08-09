import { $ } from "bun";
import { resolve as resolvePath } from "path";
import { parseGitHubRemote, type ProviderIdentity } from "./identity";

/**
 * A repository resolved from a path on this machine, in the shape a project
 * binding stores.
 */
export interface ResolvedRepo {
  /**
   * Absolute path to the repo's **main** checkout, which is not necessarily
   * the path that was passed in — resolving from inside a linked worktree
   * yields the main checkout, because a worktree is temporary and a binding
   * that outlives it must not point at a deleted directory.
   */
  path: string;
  /** Portable identity, parsed from `origin`. */
  provider: ProviderIdentity;
  /** From `origin/HEAD`; absent when the ref is unset, which is common. */
  defaultBranch?: string;
}

/**
 * Why a path could not be bound. Each maps to a distinct user-facing fix:
 * `not-a-repo` → clone or `git init`, `no-remote` → add an `origin`,
 * `not-github` → the remote points somewhere bertrand cannot talk to.
 */
export type RepoFailureReason = "not-a-repo" | "no-remote" | "not-github";

export type RepoResolution =
  | { ok: true; repo: ResolvedRepo }
  | {
      ok: false;
      reason: RepoFailureReason;
      /** The offending remote, when we got far enough to read one. */
      remoteUrl?: string;
    };

/** Runs `git -C <cwd> <args>`, resolving with trimmed stdout or rejecting. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

const defaultGitRunner: GitRunner = async (cwd, args) =>
  (await $`git -C ${cwd} ${args}`.quiet().text()).trim();

/**
 * Positive results are cached briefly: a repo's remote rarely changes, but
 * when someone does re-point `origin` we want to notice within a poll or two.
 */
const POSITIVE_TTL_MS = 30_000;

/**
 * Failures are cached far longer. An unbindable path is usually permanently
 * unbindable, and it is the case where retrying costs the most — every miss
 * spawns git again on a path that will fail again.
 */
const NEGATIVE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  result: RepoResolution;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Resolutions that have started but not settled, keyed identically to the
 * cache. The dashboard polls every project on an interval, so without this a
 * burst of concurrent callers would each spawn their own `git`.
 */
const inFlight = new Map<string, Promise<RepoResolution>>();

let gitRunner: GitRunner = defaultGitRunner;
let now: () => number = Date.now;

const WORKTREE_PREFIX = "worktree ";
const ORIGIN_PREFIX = "origin/";

/**
 * The main working tree of the repo containing `path`, or null when `path` is
 * not in a repo at all. `git worktree list` always reports the main working
 * tree first, matching {@link import("@/lib/git").getMainWorktree}, and it
 * fails outright outside a repo — so one call both validates and resolves.
 */
async function findMainWorktree(path: string): Promise<string | null> {
  try {
    const out = await gitRunner(path, ["worktree", "list", "--porcelain"]);
    const first = out.split("\n").find((line) => line.startsWith(WORKTREE_PREFIX));
    return first ? first.slice(WORKTREE_PREFIX.length).trim() || null : null;
  } catch {
    return null;
  }
}

/** The `origin` remote URL, or null when the repo has no `origin`. */
async function readOriginUrl(root: string): Promise<string | null> {
  try {
    // `--get` exits non-zero when the key is unset, so the catch is the
    // no-remote path; the emptiness check covers a set-but-blank value.
    const url = await gitRunner(root, ["config", "--get", "remote.origin.url"]);
    return url || null;
  } catch {
    return null;
  }
}

/**
 * The branch `origin/HEAD` points at. Purely local — `symbolic-ref` reads the
 * ref that `clone` wrote, and never touches the network. Undefined is a normal
 * outcome: `origin/HEAD` is absent on many clones and after some fetches.
 */
async function readDefaultBranch(root: string): Promise<string | undefined> {
  try {
    const ref = await gitRunner(root, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    const branch = ref.startsWith(ORIGIN_PREFIX) ? ref.slice(ORIGIN_PREFIX.length) : ref;
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/** The real work, run at most once per path per TTL window. */
async function resolveUncached(path: string): Promise<RepoResolution> {
  const root = await findMainWorktree(path);

  if (!root) {
    return { ok: false, reason: "not-a-repo" };
  }

  const remoteUrl = await readOriginUrl(root);

  if (!remoteUrl) {
    return { ok: false, reason: "no-remote" };
  }

  const provider = parseGitHubRemote(remoteUrl);

  if (!provider) {
    return { ok: false, reason: "not-github", remoteUrl };
  }

  const defaultBranch = await readDefaultBranch(root);
  const repo: ResolvedRepo = { path: root, provider };

  if (defaultBranch) {
    repo.defaultBranch = defaultBranch;
  }

  return { ok: true, repo };
}

/**
 * Resolve the GitHub repository a path belongs to.
 *
 * Never throws: every failure is a typed {@link RepoResolution}, because
 * callers ask this on a polling path where an exception would blank the UI.
 *
 * Results are TTL-cached and concurrent calls for the same path are coalesced
 * into a single resolution, so polling N projects costs N resolutions per
 * window rather than N per render.
 */
export function resolveRepoAt(path: string): Promise<RepoResolution> {
  // Key on the absolute path so `.` and an equivalent absolute path share an
  // entry. Distinct paths inside one repo still resolve separately, which
  // costs a duplicate lookup but never a wrong answer.
  const key = resolvePath(path);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now()) {
    return Promise.resolve(cached.result);
  }

  const pending = inFlight.get(key);

  if (pending) {
    return pending;
  }

  const promise = resolveUncached(key)
    .then((result) => {
      const ttl = result.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      cache.set(key, { result, expiresAt: now() + ttl });
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);

  return promise;
}

/** Drop every cached and in-flight resolution. */
export function _resetRepoCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Swap the git subprocess runner. Pass null to restore the real one. */
export function _setGitRunner(runner: GitRunner | null): void {
  gitRunner = runner ?? defaultGitRunner;
}

/** Swap the TTL clock, so expiry is testable without waiting. */
export function _setClock(clock: (() => number) | null): void {
  now = clock ?? Date.now;
}
