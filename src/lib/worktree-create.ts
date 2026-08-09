import { existsSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { createWorktree, getMainWorktree, shellDetail } from "@/lib/git";

/**
 * Where session worktrees live, relative to the repo's main checkout.
 *
 * Not a new convention: `src/lib/diff_stats.ts` already collapses this infix so
 * a file edited inside a worktree reads as its logical repo path, and the
 * `worktree.entered` hook has been recording paths in this shape all along.
 * Creating them here just makes the layout explicit instead of implied.
 */
export const WORKTREES_DIR = ".claude/worktrees";

export type CreateWorktreeReason =
  | "not-a-repo"
  | "path-exists"
  | "branch-exists"
  | "git-failed";

export interface WorktreeTarget {
  /**
   * The repo's main checkout. Every git call is anchored here rather than at
   * `process.cwd()`, so creation behaves identically from the CLI and from
   * `bertrand serve` — which runs from wherever it was launched.
   */
  root: string;
  path: string;
  branch: string;
}

export type WorktreeCreateResult =
  | { ok: true; target: WorktreeTarget }
  | { ok: false; reason: CreateWorktreeReason; detail?: string };

/**
 * Whether `cwd` sits inside a git working tree.
 *
 * This exists because `getMainWorktree` falls back to returning its own input
 * when it can't parse `git worktree list`. That's right for its other callers,
 * which all pass a path already known to be in a repo — but creation is the
 * first caller to take an unvalidated directory, and without this check a
 * non-repo path would silently become a "root" and put a worktree somewhere
 * nobody asked for.
 */
async function isInsideRepo(cwd: string): Promise<boolean> {
  try {
    const out = await $`git -C ${cwd} rev-parse --is-inside-work-tree`.quiet().text();
    return out.trim() === "true";
  } catch {
    return false;
  }
}

async function branchExists(root: string, branch: string): Promise<boolean> {
  try {
    await $`git -C ${root} show-ref --verify --quiet refs/heads/${branch}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Work out where a session's worktree should go, without creating anything.
 *
 * Returns a discriminated result rather than throwing, matching
 * `RemoveWorktreeResult` — a daemon has no human to hand an exception to, so
 * each failure needs a name the API layer can map to a status.
 */
export async function resolveWorktreeTarget(
  cwd: string,
  slug: string,
): Promise<WorktreeCreateResult> {
  if (!existsSync(cwd) || !(await isInsideRepo(cwd))) {
    return { ok: false, reason: "not-a-repo", detail: cwd };
  }

  // Resolved from the main checkout so that creating from *inside* an existing
  // worktree still nests the new one under the repo root, not under a sibling.
  const root = await getMainWorktree(cwd);
  const path = join(root, WORKTREES_DIR, slug);
  const branch = slug;

  if (existsSync(path)) return { ok: false, reason: "path-exists", detail: path };
  if (await branchExists(root, branch)) {
    return { ok: false, reason: "branch-exists", detail: branch };
  }

  return { ok: true, target: { root, path, branch } };
}

/**
 * Create a session's worktree: resolve the target, then hand it to git anchored
 * at the main checkout. The branch is named for the slug, matching what the
 * hook path already produces for CLI sessions — a dashboard-created worktree
 * should be indistinguishable from one Claude entered itself.
 */
export async function createSessionWorktree(
  cwd: string,
  slug: string,
  opts: { baseBranch?: string } = {},
): Promise<WorktreeCreateResult> {
  const resolved = await resolveWorktreeTarget(cwd, slug);
  if (!resolved.ok) return resolved;

  const { target } = resolved;
  try {
    await createWorktree(target.path, target.branch, {
      baseBranch: opts.baseBranch,
      cwd: target.root,
    });
  } catch (err) {
    return { ok: false, reason: "git-failed", detail: shellDetail(err) };
  }

  return { ok: true, target };
}
