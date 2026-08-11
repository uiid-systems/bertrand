import { existsSync } from "fs";
import { getSession, updateSession } from "@/db/queries/sessions";
import { emitWorktreeExited } from "@/db/events/emit";
import { teardownWorkspace } from "@/lib/workspace";
import { snapshotGitDiffStats } from "@/lib/stats-snapshot";
import { getMainWorktree, removeWorktree, shellDetail } from "@/lib/git";
import type { Db } from "@/db/client";
import type { SessionRow } from "@/types";
import type { RemoveWorktreeReason } from "./worktree-remove-types";

// Declared in the leaf `./worktree-remove-types` so the dashboard can name a
// failure reason without its type graph following the `fs`/db/`bun` imports
// above; re-exported because this is where callers of the remover expect it.
export type { RemoveWorktreeReason } from "./worktree-remove-types";

export type RemoveWorktreeResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: RemoveWorktreeReason; detail?: string };

const ACTIVE_STATUSES = ["active", "waiting", "blocked"] as const;

/**
 * Delete a session's git worktree and clear its worktree record — the
 * dashboard's "delete worktree" action.
 *
 * Refuses live sessions: a Claude is (or may momentarily be) working in that
 * directory. For everyone else, the order is snapshot → teardown → git →
 * record: capture the session's git-derived line counts while there is still a
 * worktree to measure, stop the dev server and run the repo's archive script
 * (teardown waits for it, bounded, so `git worktree remove` doesn't pull the
 * cwd out from under a running `docker compose down`), remove the worktree via
 * the repo's main checkout, then clear the session's worktree columns and
 * record the exit on its timeline.
 *
 * Without `force`, a dirty tree comes back as `dirty` so the caller can put
 * the destructive variant behind its own explicit confirmation. The branch
 * is never deleted — only the checkout goes; unmerged work stays reachable.
 * A directory already deleted by hand skips git and just clears the record,
 * so a half-cleaned session can always be fully cleaned from the dashboard.
 */
export async function removeSessionWorktree(
  id: string,
  opts: { force?: boolean; db?: Db } = {},
): Promise<RemoveWorktreeResult> {
  const { force = false, db } = opts;
  const session = getSession(id, db);
  if (!session) return { ok: false, reason: "not-found" };
  if (!session.worktreePath) return { ok: false, reason: "no-worktree" };
  if ((ACTIVE_STATUSES as readonly string[]).includes(session.status)) {
    return { ok: false, reason: "active" };
  }

  // Last chance to measure this session. Everything below deletes the only
  // thing `git diff` could read, so the capture happens here — before teardown,
  // not just before `git worktree remove` — because teardown runs the repo's
  // archive script and a `docker compose down` that rewrites the tree would
  // change the answer.
  //
  // Best-effort by design: a session's line counts are not worth failing a
  // removal the user asked for. A capture that throws leaves the previously
  // stored counters in place, which is exactly where they were before.
  try {
    await snapshotGitDiffStats(session, { db });
  } catch {
    // ignored — see above
  }

  await teardownWorkspace({
    sessionId: session.id,
    worktreePath: session.worktreePath,
    slug: session.slug,
  });

  if (existsSync(session.worktreePath)) {
    const root = await getMainWorktree(session.worktreePath);
    try {
      await removeWorktree(session.worktreePath, { force, cwd: root });
    } catch (err) {
      const detail = shellDetail(err);
      if (!force && /modified or untracked files/i.test(detail)) {
        return { ok: false, reason: "dirty", detail };
      }
      return { ok: false, reason: "git-failed", detail };
    }
  }

  emitWorktreeExited(
    { sessionId: session.id, path: session.worktreePath, branch: session.worktreeBranch ?? undefined },
    db,
  );
  const updated = updateSession(
    session.id,
    { worktreePath: null, worktreeBranch: null },
    db,
  );
  return { ok: true, session: updated };
}
