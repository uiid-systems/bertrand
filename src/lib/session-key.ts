import { $ } from "bun";
import { resolve as resolvePath } from "path";
import { formatIdentity } from "@/lib/github/identity";
import { resolveRepoAt } from "@/lib/github/resolve";

/**
 * Where a session is running, derived from its cwd.
 *
 * This replaces the project registry as bertrand's grouping dimension. A
 * project was a row a human had to create, bind to a repo, and remember to
 * switch to; getting any of those wrong filed a session under the wrong name
 * with no error and no symptom. Every field here is read from `git` at session
 * start instead, so the answer cannot drift from the truth and there is nothing
 * to register.
 *
 * Every field is nullable and null is ordinary, not an error: bertrand records
 * sessions in directories that are not repos, and it must keep doing so.
 *
 * Read from `git` alone, never from a host's environment. `ORCA_WORKTREE_ID`
 * carries the workspace path and would shortcut most of this, at the cost of
 * binding bertrand to one launcher — `docs/orca-boundary.md` decision #4
 * governs, and `git` is the host-agnostic channel.
 */
export interface SessionKey {
  /**
   * Absolute path to the git worktree root holding `cwd` — the *linked*
   * worktree when there is one, not the main checkout. This is the stable
   * per-task key: a branch can be renamed or rebased under a session, but a
   * worktree keeps its path for as long as it exists.
   */
  worktreeRoot: string | null;
  /**
   * Absolute path to the repo's main checkout. Equal to `worktreeRoot` when
   * `cwd` is in the main checkout itself, which is the case that makes
   * `worktreeRoot` alone insufficient as an identity — see {@link groupKey}.
   */
  mainCheckout: string | null;
  /**
   * Branch checked out at `cwd`. Null outside a repo and on a detached HEAD;
   * `getCurrentBranch` explains why the literal `"HEAD"` never lands here.
   */
  branch: string | null;
  /**
   * Portable repo identity as `owner/repo` (or `host/owner/repo` for GHES),
   * parsed from `origin`. Machine-independent on purpose: it is what lets two
   * checkouts of one repo — a main checkout and a stack of linked worktrees —
   * roll up together without anyone binding a path.
   *
   * Null when `cwd` is not a repo, has no `origin`, or points at a forge
   * bertrand cannot parse. A session still records; it just does not roll up.
   */
  repo: string | null;
}

/** Runs `git -C <cwd> <args>`, resolving with trimmed stdout or rejecting. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

const defaultGitRunner: GitRunner = async (cwd, args) =>
  (await $`git -C ${cwd} ${args}`.quiet().text()).trim();

let gitRunner: GitRunner = defaultGitRunner;

/** Swap the git runner — for tests only. */
export function _setGitRunner(runner: GitRunner | null): void {
  gitRunner = runner ?? defaultGitRunner;
}

/** Run git, or resolve null on any failure. Every field here is optional. */
async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const out = await gitRunner(cwd, args);
    return out || null;
  } catch {
    return null;
  }
}

/**
 * The main checkout behind `--git-common-dir`.
 *
 * `--git-common-dir` answers with the *shared* git directory: `<main>/.git`
 * from anywhere in the repo, including a linked worktree, where
 * `--show-toplevel` answers with the worktree instead. Stripping the trailing
 * `/.git` is what turns it back into a checkout path.
 *
 * A bare repo has no `.git` suffix to strip and no working tree to name, so it
 * yields null rather than a directory nobody can cd into. Git may answer
 * relatively (a literal `.git` when cwd *is* the main checkout), so the result
 * is resolved against `cwd` before the suffix is removed.
 */
function mainCheckoutFrom(cwd: string, commonDir: string | null): string | null {
  if (!commonDir) return null;
  const absolute = resolvePath(cwd, commonDir);
  return absolute.endsWith("/.git") ? absolute.slice(0, -"/.git".length) : null;
}

/**
 * Derive the grouping key for a session running in `cwd`.
 *
 * Never throws and never refuses: an unresolvable cwd yields a key of all
 * nulls, which callers must treat as "record it anyway, ungrouped". Refusing
 * here would make git a requirement for recording a session, which it is not.
 *
 * Costs up to four `git` invocations, so callers should derive once at session
 * start and persist the result rather than re-deriving per hook tick — hook
 * subprocesses are one-shot and share no in-process cache.
 */
export async function deriveSessionKey(cwd: string): Promise<SessionKey> {
  const absolute = resolvePath(cwd);

  // Ordered cheapest-first so a non-repo cwd costs one failed git call: every
  // later lookup is pointless once `--show-toplevel` has failed.
  const worktreeRoot = await git(absolute, ["rev-parse", "--show-toplevel"]);
  if (!worktreeRoot) {
    return { worktreeRoot: null, mainCheckout: null, branch: null, repo: null };
  }

  const [commonDir, branch, resolution] = await Promise.all([
    git(absolute, ["rev-parse", "--git-common-dir"]),
    git(absolute, ["rev-parse", "--abbrev-ref", "HEAD"]),
    // Reuses the TTL-cached resolver rather than reading `origin` here, so a
    // repo already resolved this process costs nothing and the parsing of
    // remote URLs (SCP form, GHES hosts, embedded credentials) stays in the
    // one module that owns it.
    resolveRepoAt(absolute),
  ]);

  return {
    worktreeRoot,
    mainCheckout: mainCheckoutFrom(absolute, commonDir),
    // `--abbrev-ref HEAD` answers a detached HEAD with the literal "HEAD",
    // which is not a branch name and must not be recorded as one.
    branch: branch && branch !== "HEAD" ? branch : null,
    repo: resolution.ok ? formatIdentity(resolution.repo.provider) : null,
  };
}

/**
 * Stable identity for the unit of work a session belongs to, or null when the
 * cwd yields nothing to group by.
 *
 * The key is `(repo, branch)`, not the worktree path, and the main checkout is
 * why. One linked worktree holds one branch for one task, so path and branch
 * are interchangeable there — but the main checkout is a workbench that hosts
 * unrelated work for months across many branches. Keying on path alone would
 * collapse all of it into a single eternal session; keying on `(repo, branch)`
 * gives every task its own session in both places, and leaves only the repo's
 * long-lived branch (`main`) as a catch-all.
 *
 * Keying on `repo` rather than a checkout path is what makes the group survive
 * its worktree. An Orca workspace is deleted when its task lands, and a session
 * keyed on that path would lose its identity the moment the directory went
 * away — including for a `--resume` from somewhere else.
 *
 * Falls back to the worktree path when `origin` could not be parsed, so a local
 * or non-GitHub repo still groups by task instead of collapsing into the
 * ungrouped bucket. The `path:` prefix keeps the two spaces from ever
 * colliding.
 */
export function groupKey(key: SessionKey): string | null {
  if (key.repo && key.branch) return `${key.repo}@${key.branch}`;
  if (key.worktreeRoot) return `path:${key.worktreeRoot}`;
  return null;
}
