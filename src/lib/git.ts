import { $ } from "bun";

export interface Worktree {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

/** List all git worktrees in the current repo */
export async function listWorktrees(): Promise<Worktree[]> {
  const result =
    await $`git worktree list --porcelain`.text();

  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};

  for (const line of result.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current as Worktree);
      current = { path: line.slice(9), bare: false };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "bare") {
      current.bare = true;
    }
  }
  if (current.path) worktrees.push(current as Worktree);

  return worktrees;
}

/** Create a new worktree with a new branch */
export async function createWorktree(
  path: string,
  branch: string,
  baseBranch = "HEAD"
): Promise<void> {
  await $`git worktree add -b ${branch} ${path} ${baseBranch}`;
}

/** Remove a worktree */
export async function removeWorktree(
  path: string,
  force = false
): Promise<void> {
  if (force) {
    await $`git worktree remove --force ${path}`;
  } else {
    await $`git worktree remove ${path}`;
  }
}

/** Get the root of the current git repo */
export async function getRepoRoot(): Promise<string> {
  return (await $`git rev-parse --show-toplevel`.text()).trim();
}

/**
 * The branch a worktree currently has checked out. The DB records the branch
 * at EnterWorktree time, but a worktree can switch branches over its life —
 * display must follow git, not the entry-time snapshot. Null when detached
 * or unreadable; callers fall back to the recorded value.
 */
export async function getWorktreeBranch(cwd: string): Promise<string | null> {
  try {
    const out = (await $`git -C ${cwd} rev-parse --abbrev-ref HEAD`.text()).trim();
    return out && out !== "HEAD" ? out : null;
  } catch {
    return null;
  }
}

/**
 * The main working tree for the repo a worktree belongs to. `git worktree
 * list` always reports the main working tree first, so we take that entry.
 * Used to resolve `BERTRAND_ROOT` (for symlinking shared files) from a
 * session's worktree path. Falls back to the given path if parsing fails.
 */
export async function getMainWorktree(cwd: string): Promise<string> {
  const out = await $`git -C ${cwd} worktree list --porcelain`.text();
  const first = out.split("\n").find((l) => l.startsWith("worktree "));
  return first ? first.slice(9).trim() : cwd;
}
