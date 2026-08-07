import { getActiveSessions } from "@/db/queries/sessions";
import { getConversationsBySession } from "@/db/queries/conversations";
import { isRecordedProcessAlive } from "@/lib/process-identity";
import { triggerBackgroundPush } from "@/sync/trigger";
import { finalizeSessionRow } from "./finalize";

/**
 * Exit code recorded for a session whose process vanished without going
 * through any exit path. We never observed the real code — the process was
 * already gone when we noticed — so this stands in for "died abnormally".
 */
const CRASHED_EXIT_CODE = 1;

/**
 * Detect sessions stuck in an active state (active/waiting) whose owning
 * process is no longer running, and finalize them.
 *
 * Liveness is identity-checked, not a bare `kill(pid, 0)` (#209). The pid on a
 * stale row belongs to a process that is already gone, and the OS is free to
 * hand that number to something unrelated; a bare probe would then read the
 * row as live and it would **never** be recovered. Rows written before
 * `pidStartedAt` existed carry no identity, so they fall back to the old
 * liveness-only behavior rather than being declared dead wholesale.
 *
 * Recovery runs the *same* bookkeeping as a clean exit, via
 * `finalizeSessionRow`. It previously did a partial job — status and summary,
 * but no `endedAt`, timing, or marker pruning — which left crashed sessions
 * with broken durations and stats. That divergence is exactly the defect #208
 * hit when the dashboard path had its own finalize; there should only ever be
 * one.
 *
 * Scoped to the active project's DB, which is where every recoverable session
 * lives: the CLI recovers the project it was launched in, and dashboard
 * sessions are always created in serve's active project
 * (`spawnDashboardSession` resolves it).
 *
 * Returns the number of recovered sessions.
 */
export async function recoverStaleSessions(): Promise<number> {
  const active = getActiveSessions();
  let recovered = 0;

  for (const { session } of active) {
    if (!session.pid) continue;
    if (await isRecordedProcessAlive(session.pid, session.pidStartedAt)) continue;

    // Newest first. A session with no conversation rows still finalizes:
    // finalizeSessionRow resolves an unknown id to "no conversation" and
    // emits the ended event without one.
    const conversationId = getConversationsBySession(session.id)[0]?.id ?? "";

    finalizeSessionRow(session.id, conversationId, CRASHED_EXIT_CODE, {
      // Recovery runs either inside `bertrand serve` (stopping the server
      // would kill the process executing this) or at the head of `bertrand
      // launch`, which is about to need the server anyway. Never tear it down.
      stopServerWhenIdle: false,
      // One push after the sweep, not one per session — see the option's docs.
      triggerSyncPush: false,
    });
    recovered++;
  }

  if (recovered > 0) triggerBackgroundPush();

  return recovered;
}
