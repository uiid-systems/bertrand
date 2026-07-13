import { getEventsByType } from "@/db/queries/events";
import { getDb, type Db } from "@/db/client";
import type { ChangedFile } from "@/lib/git";

export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
  filesTouched: number;
}

type EditEntry = { oldStr?: string; newStr?: string };
type PermissionDetail = {
  tool?: string;
  detail?: string;
  oldStr?: string;
  newStr?: string;
  edits?: EditEntry[];
};

function lineCount(s?: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

/**
 * Turn an absolute edit path into something readable in the sidebar. Edits
 * carry absolute paths; two normalizations make them repo-relative:
 *   1. Collapse a `.claude/worktrees/<name>/` infix so a file edited inside a
 *      worktree reads as its logical repo path (…/worktrees/x/src/a → src/a).
 *   2. Strip the server's working directory (the active project's repo root).
 * Cross-project paths that match neither fall back to the absolute path — the
 * row still shows the filename and a full-path tooltip.
 */
function toDisplayPath(p: string): string {
  const wt = p.match(/^(.*)\/\.claude\/worktrees\/[^/]+\/(.+)$/);
  const abs = wt ? `${wt[1]}/${wt[2]}` : p;
  const root = process.cwd();
  if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
  return abs;
}

/**
 * Per-file added/removed line tallies for a session, accumulated from its
 * `tool.applied` events. This is the single source both the primary sidebar's
 * aggregate counts and the secondary sidebar's per-file list are drawn from,
 * so the two can never disagree. Timeline-derived (not git), so it covers
 * every session whether or not a worktree exists.
 */
function accumulateFileDiffs(
  sessionId: string,
  db: Db,
): Map<string, { added: number; removed: number }> {
  const applied = getEventsByType(sessionId, "tool.applied", db);
  const byFile = new Map<string, { added: number; removed: number }>();

  for (const ev of applied) {
    const meta = ev.meta as Record<string, unknown> | null;
    const permissions = (meta?.permissions ?? []) as PermissionDetail[];
    for (const p of permissions) {
      if (!p.detail) continue;
      const entry = byFile.get(p.detail) ?? { added: 0, removed: 0 };
      if (p.edits && p.edits.length > 0) {
        for (const e of p.edits) {
          entry.removed += lineCount(e.oldStr);
          entry.added += lineCount(e.newStr);
        }
      } else {
        entry.removed += lineCount(p.oldStr);
        entry.added += lineCount(p.newStr);
      }
      byFile.set(p.detail, entry);
    }
  }

  return byFile;
}

export function computeDiffStats(
  sessionId: string,
  db: Db = getDb(),
): DiffStats {
  const byFile = accumulateFileDiffs(sessionId, db);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const { added, removed } of byFile.values()) {
    linesAdded += added;
    linesRemoved += removed;
  }
  return { linesAdded, linesRemoved, filesTouched: byFile.size };
}

/**
 * The individual files a session changed, with per-file line counts — the
 * secondary sidebar's "Files changed" list. Shares the accumulator above with
 * `computeDiffStats`, so the file count and totals always match the primary
 * sidebar. Status is inferred from the net line delta (we don't have git's
 * verdict here): purely-added → added, purely-removed → deleted, otherwise
 * modified. Busiest files first.
 */
export function computeChangedFiles(
  sessionId: string,
  db: Db = getDb(),
): ChangedFile[] {
  const byFile = accumulateFileDiffs(sessionId, db);
  const files: ChangedFile[] = [];
  for (const [path, { added, removed }] of byFile) {
    const status: ChangedFile["status"] =
      removed === 0 && added > 0
        ? "added"
        : added === 0 && removed > 0
          ? "deleted"
          : "modified";
    files.push({ path: toDisplayPath(path), added, removed, status });
  }
  files.sort(
    (a, b) =>
      (b.added ?? 0) + (b.removed ?? 0) - (a.added ?? 0) - (a.removed ?? 0),
  );
  return files;
}
