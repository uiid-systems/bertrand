import { getDb, type Db } from "@/db/client";
import { getSessionStats, snapshotDiffStats } from "@/db/queries/stats";
import {
  gitDiffStats,
  type DiffStats,
  type WorktreeFilesReader,
} from "@/lib/diff_stats";
import { computeAndPersist } from "@/lib/timing";

export interface SnapshotTarget {
  id: string;
  worktreePath: string | null;
}

export interface SnapshotOptions {
  db?: Db;
  read?: WorktreeFilesReader;
}

function isEmpty(d: DiffStats): boolean {
  return d.linesAdded === 0 && d.linesRemoved === 0 && d.filesTouched === 0;
}

/**
 * Capture a session's git-derived diff counters into `session_stats` while
 * they can still be measured.
 *
 * Event-derived stats are recomputable forever — the events are immutable rows.
 * Git-derived stats are not: `git diff` needs a worktree, and once that is
 * removed the session's real line counts are gone for good. This is the write
 * that makes them survive, so it has to happen *before* the directory does not.
 *
 * Returns the captured counters, or `null` when nothing was captured — no
 * worktree on disk, or git's answer was not trustworthy enough to store. A
 * `null` never modifies the row, so the previous value always stands.
 *
 * Two answers are deliberately refused:
 *
 *   - **An empty diff over a non-empty row.** `getWorktreeChangedFiles`
 *     collapses failure into an empty list, so "no changed files" is ambiguous:
 *     it is what a clean worktree looks like, and equally what a git that could
 *     not answer looks like. It is also what a *merged* branch looks like — once
 *     the work lands on main the merge base advances to the branch tip and the
 *     diff legitimately empties, which would otherwise blank the numbers of
 *     exactly those sessions that finished successfully. Keeping the stored
 *     value costs a session that genuinely reverted all its work an out-of-date
 *     row; taking the empty answer costs every merged session its history.
 *
 *   - **A repeat of what is already stored.** The dashboard polls, and a write
 *     per poll would churn `updated_at` for no new information.
 */
export async function snapshotGitDiffStats(
  session: SnapshotTarget,
  opts: SnapshotOptions = {},
): Promise<DiffStats | null> {
  const db = opts.db ?? getDb();

  const diff = await gitDiffStats(session, opts.read);
  if (!diff) return null;

  // Materialize the row first when the session has never had one: the snapshot
  // is a targeted UPDATE of three columns, and an UPDATE matching no rows would
  // drop the capture on the floor.
  let stored = getSessionStats(session.id, db);
  if (!stored) {
    computeAndPersist(session.id, db);
    stored = getSessionStats(session.id, db);
  }
  if (!stored) return null;

  const unchanged =
    stored.diffSource === "git" &&
    stored.linesAdded === diff.linesAdded &&
    stored.linesRemoved === diff.linesRemoved &&
    stored.filesTouched === diff.filesTouched;
  if (unchanged) return diff;

  if (isEmpty(diff) && !isEmpty(stored)) return null;

  snapshotDiffStats(session.id, diff, db);
  return diff;
}
