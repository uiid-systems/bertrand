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

/**
 * Remove a worktree. Pass `cwd` (typically the repo's main checkout) whenever
 * the calling process isn't guaranteed to be inside the owning repo — the
 * dashboard server runs from wherever `bertrand serve` was launched, and git
 * refuses to remove the worktree the process is standing in.
 */
export async function removeWorktree(
  path: string,
  opts: { force?: boolean; cwd?: string } = {}
): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.force) {
    await $`git -C ${cwd} worktree remove --force ${path}`.quiet();
  } else {
    await $`git -C ${cwd} worktree remove ${path}`.quiet();
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

/** A file a worktree changed relative to its merge base with the main branch. */
export interface ChangedFile {
  path: string;
  /** Line counts from --numstat; null for binary and untracked files. */
  added: number | null;
  removed: number | null;
  status: "added" | "modified" | "deleted" | "untracked";
}

export interface WorktreeChangedFiles {
  /** Merge-base commit the diff runs against; null when it couldn't be
   * resolved and only uncommitted changes (vs HEAD) are shown. */
  base: string | null;
  files: ChangedFile[];
}

/** Parse `git diff --numstat` lines: `<added>\t<removed>\t<path>`, `-` for binary. */
export function parseNumstat(
  out: string,
): Map<string, { added: number | null; removed: number | null }> {
  const counts = new Map<string, { added: number | null; removed: number | null }>();
  for (const line of out.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    counts.set(path, {
      added: added === "-" ? null : Number(added),
      removed: removed === "-" ? null : Number(removed),
    });
  }
  return counts;
}

/** Parse `git diff --name-status` lines: `<letter>\t<path>`. */
export function parseNameStatus(out: string): Map<string, ChangedFile["status"]> {
  const statuses = new Map<string, ChangedFile["status"]>();
  for (const line of out.split("\n")) {
    const [letter, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!letter || !path) continue;
    statuses.set(path, letter[0] === "A" ? "added" : letter[0] === "D" ? "deleted" : "modified");
  }
  return statuses;
}

/**
 * What a worktree changed, as `git diff` sees it: commits since branching off
 * the main checkout's branch plus uncommitted edits, plus untracked files.
 * Diffing against the merge base (not the main branch's tip) keeps the list
 * "what this session did" even after main moves on. Renames are disabled so
 * a rename reads as delete + add — no `old => new` path parsing. Falls back
 * to uncommitted-only (vs HEAD) when no base is resolvable, and to an empty
 * list when git itself fails (deleted dir, not a repo).
 */
export async function getWorktreeChangedFiles(
  cwd: string,
): Promise<WorktreeChangedFiles> {
  let base: string | null = null;
  try {
    const mainPath = await getMainWorktree(cwd);
    const mainBranch = mainPath === cwd ? null : await getWorktreeBranch(mainPath);
    if (mainBranch) {
      const mb = (await $`git -C ${cwd} merge-base HEAD ${mainBranch}`.text()).trim();
      base = mb || null;
    }
  } catch {
    base = null;
  }

  try {
    const target = base ?? "HEAD";
    const [numstatOut, statusOut, untrackedOut] = await Promise.all([
      $`git -C ${cwd} diff --numstat --no-renames ${target}`.text(),
      $`git -C ${cwd} diff --name-status --no-renames ${target}`.text(),
      $`git -C ${cwd} ls-files --others --exclude-standard`.text(),
    ]);
    const counts = parseNumstat(numstatOut);
    const statuses = parseNameStatus(statusOut);
    const files: ChangedFile[] = [];
    for (const [path, { added, removed }] of counts) {
      files.push({ path, added, removed, status: statuses.get(path) ?? "modified" });
    }
    for (const line of untrackedOut.split("\n")) {
      const path = line.trim();
      if (path) files.push({ path, added: null, removed: null, status: "untracked" });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { base, files };
  } catch {
    return { base: null, files: [] };
  }
}
