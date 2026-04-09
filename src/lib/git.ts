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
