import { existsSync } from "fs";

import { getEventsByType } from "@/db/queries/events";
import { getDb, type Db } from "@/db/client";
import { getWorktreeChangedFiles, type ChangedFile } from "@/lib/git";

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
 *   2. Strip `root` — the repo root of the project that owns the session.
 *
 * `root` is supplied by the caller rather than read from `process.cwd()`. The
 * server runs from wherever `bertrand serve` was launched, so the process
 * directory bears no relation to the repo being rendered; from `/tmp` every
 * path failed to match and the sidebar showed absolute paths for everything.
 *
 * `undefined` is a legitimate answer — an unbound project has no root — and
 * lands on the same absolute-path fallback as a cross-project path. The row
 * still shows the filename and a full-path tooltip.
 */
function toDisplayPath(p: string, root: string | undefined): string {
  const wt = p.match(/^(.*)\/\.claude\/worktrees\/[^/]+\/(.+)$/);
  const abs = wt ? `${wt[1]}/${wt[2]}` : p;
  if (root && abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
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
 * The individual files a session changed, replayed from its timeline. The
 * fallback arm of `resolveChangedFiles` — used only where git cannot answer.
 *
 * Status is inferred from the net line delta (we don't have git's verdict
 * here): purely-added → added, purely-removed → deleted, otherwise modified.
 * Busiest files first.
 */
export function computeChangedFiles(
  sessionId: string,
  root: string | undefined,
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
    files.push({ path: toDisplayPath(path, root), added, removed, status });
  }
  files.sort(
    (a, b) =>
      (b.added ?? 0) + (b.removed ?? 0) - (a.added ?? 0) - (a.removed ?? 0),
  );
  return files;
}

/** Reads a worktree's changed files. Injectable so the server can share its
 *  short-lived cache with `/api/worktrees/:id/files` — both poll the same
 *  git subprocesses — and so tests can stand in a fake. */
export type WorktreeFilesReader = (
  worktreePath: string,
) => Promise<ChangedFile[]>;

const readWorktreeFiles: WorktreeFilesReader = async (worktreePath) =>
  (await getWorktreeChangedFiles(worktreePath)).files;

/**
 * The files a session changed, replayed from its own timeline. The single
 * source behind the secondary sidebar's "Files changed" list.
 *
 * There used to be a git arm here, preferred wherever a worktree was on disk
 * because diffing a branch against its merge base reports the session's *net*
 * effect rather than what the agent typed. Worktrees are gone, so the replay
 * is the only per-file answer — and the better one to be left with, since it
 * stays computable forever from immutable event rows.
 *
 * The *aggregate* counters are the exception. Rows already stamped
 * `diff_source = 'git'` keep their branch-accurate totals, which the server
 * overlays in `withStoredGitDiffs`. Those numbers can disagree with the sum of
 * this list for such a session: the snapshot measured a branch, this measures
 * a timeline.
 */
export async function resolveChangedFiles(
  session: { id: string },
  root: string | undefined,
  db: Db = getDb(),
): Promise<ChangedFile[]> {
  return computeChangedFiles(session.id, root, db);
}

/** Roll a git changed-file list up into the three aggregate counters.
 *
 *  Untracked files carry `null` counts — `--numstat` never saw them — so they
 *  add to `filesTouched` without moving the line totals. That is the same
 *  arithmetic the changed-files list displays, so the sidebar's `+N/−N` and its
 *  file rows always sum to each other. */
export function sumChangedFiles(files: ChangedFile[]): DiffStats {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const f of files) {
    linesAdded += f.added ?? 0;
    linesRemoved += f.removed ?? 0;
  }
  return { linesAdded, linesRemoved, filesTouched: files.length };
}

/**
 * A session's diff counters as git sees them, or `null` when git cannot be
 * asked — the session has no worktree, or the directory is already gone.
 *
 * `null` is the important half of the return type. It is what stops a removed
 * worktree from being read as "this session changed nothing": git answers a
 * missing directory with an empty list, so a caller that took that at face
 * value would write zeros over a completed session's history.
 */
export async function gitDiffStats(
  session: { worktreePath: string | null },
  read: WorktreeFilesReader = readWorktreeFiles,
): Promise<DiffStats | null> {
  if (!session.worktreePath || !existsSync(session.worktreePath)) return null;
  return sumChangedFiles(await read(session.worktreePath));
}
