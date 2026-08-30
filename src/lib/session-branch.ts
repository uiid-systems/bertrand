import { getCurrentBranch } from "@/lib/git";
import { updateSession } from "@/db/queries/sessions";
import type { Db } from "@/db/client";

/**
 * Record the branch a session is running on, read from its cwd.
 *
 * Called at every session start, including resume: the column is current state,
 * not history, and a session can come back on a different branch than it left.
 * The history of where a session ran lives in its `claude.started` events.
 *
 * Never throws and never refuses. A cwd outside a repo records `null` — bertrand
 * logs non-repo sessions, so "no branch" is an ordinary outcome, not a failure
 * worth interrupting a session start for.
 */
export async function recordSessionBranch(
  sessionId: string,
  cwd: string,
  db?: Db,
): Promise<string | null> {
  const branch = await getCurrentBranch(cwd);
  updateSession(sessionId, { branch }, db);
  return branch;
}
