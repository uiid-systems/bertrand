import { $ } from "bun";
import type { ChangedFile } from "./git-types";

/** Prefer git's stderr over Bun's generic "exited with code 128" message. */
export function shellDetail(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr: unknown }).stderr ?? "").trim();
    if (stderr) return stderr;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Get the root of the current git repo */
export async function getRepoRoot(): Promise<string> {
  return (await $`git rev-parse --show-toplevel`.text()).trim();
}

/**
 * The branch currently checked out in `cwd`, or null when there isn't one.
 *
 * Null covers three cases that all mean the same thing to a caller — "this
 * directory has no branch to record": `cwd` is not in a git repo, it does not
 * exist, or HEAD is detached. Detached HEAD is the one worth naming, because
 * `rev-parse --abbrev-ref HEAD` answers it with the literal string `"HEAD"`,
 * which would otherwise be recorded as a branch name.
 *
 * This is the helper worktree teardown deleted as `getWorktreeBranch`. Nothing
 * about it was worktree-specific — it reads a directory's branch — so it comes
 * back under a name that says so.
 */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const out = (await $`git -C ${cwd} rev-parse --abbrev-ref HEAD`.text()).trim();
    return out && out !== "HEAD" ? out : null;
  } catch {
    return null;
  }
}

// Declared in the leaf `./git-types` so the dashboard's type graph stops
// there instead of following this module's `bun` import; re-exported because
// this is where callers of the git helpers expect them.
export type { ChangedFile } from "./git-types";

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
