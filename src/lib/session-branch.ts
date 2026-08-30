import { getCurrentBranch } from "@/lib/git";
import { updateSession } from "@/db/queries/sessions";

/**
 * Record the branch a session is running on, read from its cwd.
 *
 * Called at every session start, including resume: the column is current state,
 * not history, and a session can come back on a different branch than it left.
 * The history of where a session ran lives in its `claude.started` events.
 *
 * Reading the branch never refuses and never throws: a cwd outside a repo — or
 * one that is gone, or on a detached HEAD — records `null`. bertrand logs
 * non-repo sessions, so "no branch" is an ordinary outcome, not a failure worth
 * interrupting a start for.
 *
 * The write is not similarly guarded, deliberately. If `updateSession` throws
 * the DB is unwritable, which is not a condition a session start should paper
 * over — every caller is about to write more rows than this one.
 */
export async function recordSessionBranch(
  sessionId: string,
  cwd: string,
): Promise<string | null> {
  const branch = await getCurrentBranch(cwd);
  updateSession(sessionId, { branch });
  return branch;
}
