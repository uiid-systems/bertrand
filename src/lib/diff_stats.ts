import { getEventsByType } from "@/db/queries/events";
import { getDb, type Db } from "@/db/client";

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
