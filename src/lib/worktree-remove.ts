import { existsSync } from "fs";
import { getSession, updateSession } from "@/db/queries/sessions";
import { emitWorktreeExited } from "@/db/events/emit";
import { teardownWorkspace } from "@/lib/workspace";
import { getMainWorktree, removeWorktree } from "@/lib/git";
import type { Db } from "@/db/client";
import type { SessionRow } from "@/types";

export type RemoveWorktreeReason =
  | "not-found"
  | "no-worktree"
  | "active"
  | "dirty"
  | "git-failed";

export type RemoveWorktreeResult =
  | { ok: true; session: SessionRow }
  | { ok: false; reason: RemoveWorktreeReason; detail?: string };

const ACTIVE_STATUSES = ["active", "waiting", "blocked"] as const;

/** Prefer git's stderr over Bun's generic "exited with code 128" message. */
function shellDetail(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err) {
    const stderr = String((err as { stderr: unknown }).stderr ?? "").trim();
    if (stderr) return stderr;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Delete a session's git worktree and clear its worktree record — the
 * dashboard's "delete worktree" action.
 *
 * Refuses live sessions: a Claude is (or may momentarily be) working in that
 * directory. For everyone else, the order is teardown → git → record: stop
 * the dev server and run the repo's archive script (teardown waits for it,
 * bounded, so `git worktree remove` doesn't pull the cwd out from under a
 * running `docker compose down`), remove the worktree via the repo's main
 * checkout, then clear the session's worktree columns and record the exit on
 * its timeline.
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
