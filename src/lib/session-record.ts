import { updateSession } from "@/db/queries/sessions";
import { deriveSessionKey, groupKey, type SessionKey } from "@/lib/session-key";

/**
 * A {@link SessionKey} as the `sessions` columns that hold it.
 *
 * Shared rather than spelled out at each call site because the two writers
 * disagree about *when* they write, not about *what*. `adopt` already has a
 * status/pid update to make on its re-attach path and folds the key into it, so
 * the row takes one write and one `updatedAt` bump instead of two; the launcher
 * has only a key to write and calls {@link recordSessionKey}. Both need the
 * same five columns, and a key write that set four of them would leave the row
 * self-contradictory.
 *
 * `branch` is included, and is not merely along for the ride: `groupKey` is
 * `(repo, branch)`, so a row whose `branch` disagreed with its `group_key`
 * would be lying about one of the two.
 */
export function sessionKeyColumns(key: SessionKey) {
  return {
    branch: key.branch,
    worktreeRoot: key.worktreeRoot,
    mainCheckout: key.mainCheckout,
    repo: key.repo,
    groupKey: groupKey(key),
  };
}

/**
 * Re-read where a session is running and write it to the row.
 *
 * The successor to `recordSessionBranch`, and the same shape of thing: these
 * are current-state columns, not history — the history of where a session ran
 * lives in its `claude.started` events. The branch alone used to be enough to
 * record, because the group was a project a human had picked; now the cwd is
 * the whole of a session's identity, so all five values are read together from
 * one derivation rather than a branch here and a group there. Two answers from
 * two git reads can disagree; one cannot.
 *
 * Called on every *start*, resume included, because a session can come back
 * somewhere else: a linked worktree recreated at a new path, a branch renamed
 * under it, an `origin` added after the fact.
 *
 * Never refuses and never throws on the read: a cwd outside a repo, or one that
 * is gone, records nulls. bertrand logs sessions in directories that are not
 * repos, so "no group" is an ordinary outcome and not a reason to interrupt a
 * start.
 *
 * The write is not similarly guarded, deliberately. If `updateSession` throws
 * the DB is unwritable, which is not a condition a session start should paper
 * over — every caller is about to write more rows than this one.
 *
 * Lives in `lib` rather than `engine` so both layers can reach it. `adopt` is
 * Layer 1 and may not import the launcher (`layer-boundary.test.ts`), so a
 * recorder that lived in `engine` would have forced the Layer 1 path to keep
 * its own copy of the same write.
 */
export async function recordSessionKey(
  sessionId: string,
  cwd: string,
): Promise<SessionKey> {
  const key = await deriveSessionKey(cwd);
  updateSession(sessionId, sessionKeyColumns(key));
  return key;
}
