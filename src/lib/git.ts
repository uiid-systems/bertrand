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
