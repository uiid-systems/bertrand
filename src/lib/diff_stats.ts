import { getEventsByType } from "@/db/queries/events";

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

export function computeDiffStats(sessionId: string): DiffStats {
  const applied = getEventsByType(sessionId, "tool.applied");
  const files = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const ev of applied) {
    const meta = ev.meta as Record<string, unknown> | null;
    const permissions = (meta?.permissions ?? []) as PermissionDetail[];
    for (const p of permissions) {
      if (p.detail) files.add(p.detail);
      if (p.edits && p.edits.length > 0) {
        for (const e of p.edits) {
          linesRemoved += lineCount(e.oldStr);
          linesAdded += lineCount(e.newStr);
        }
      } else {
        linesRemoved += lineCount(p.oldStr);
        linesAdded += lineCount(p.newStr);
      }
    }
  }

  return { linesAdded, linesRemoved, filesTouched: files.size };
}
