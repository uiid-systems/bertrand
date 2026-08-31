/**
 * Crash recovery for session rows. Lived in `src/engine` until ELKY-176, and
 * moved because it does not belong to the launcher: it reads and writes DB rows
 * and touches no PTY. Recovery is the *only* thing that ever finalizes an
 * adopted session (nothing stands over one to watch it exit), so it has to stay
 * reachable from `bertrand serve` and the hook path — which is exactly what a
 * demoted `src/engine` must not be. See `src/layer-boundary.test.ts`.
 */
import { getRecoverableSessions } from "@/db/queries/sessions";
import { getConversationsBySession } from "@/db/queries/conversations";
import { getLastEventAt } from "@/db/queries/events";
import { isRecordedProcessAlive } from "@/lib/process-identity";
import { triggerBackgroundPush } from "@/sync/trigger";
import { finalizeSessionRow } from "./session-finalize";

/**
 * Exit code recorded for a session whose process vanished without going
 * through any exit path. We never observed the real code — the process was
 * already gone when we noticed — so this stands in for "died abnormally".
 */
const CRASHED_EXIT_CODE = 1;

/**
 * Detect sessions whose owning process is no longer running, and finalize them.
 *
 * Candidates are every non-archived session that still records a pid, not just
 * the ones in a live status. A launched session has bertrand's own process
 * standing over it to call `finalizeSession` on exit; an *adopted* one
 * (ELKY-179) has nothing — its last word is the Stop hook's `session.paused`,
 * which leaves `endedAt`, timing and `session_stats` unwritten and the adoption
 * marker on disk. Scoping recovery to live statuses missed exactly those rows,
 * because `paused` is where they come to rest. It costs nothing to widen:
 * finalizing nulls the pid, so nothing is ever finalized twice, and a paused
 * session whose claude is still alive is skipped by the liveness check below
 * like any other.
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
 * The one thing it cannot share is *when*. A clean exit is observed as it
 * happens; recovery finds out on whatever schedule the next launch or dashboard
 * start sets — which for an adopted session is the normal case, not a crash.
 * Stamping the sweep's own clock would write that entire delay into the session
 * as work or wait time, so the end is dated to the session's last recorded
 * event instead.
 *
 * Scoped to the active project's DB, which is where every recoverable session
 * lives: the CLI recovers the project it was launched in, and dashboard
 * sessions are always created in serve's active project
 * (`spawnDashboardSession` resolves it).
 *
 * Returns the number of recovered sessions.
 */
export async function recoverStaleSessions(): Promise<number> {
  const candidates = getRecoverableSessions();
  let recovered = 0;

  for (const { session } of candidates) {
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
      // The session ended when it stopped recording, not when this sweep
      // noticed — see the option's docs. Undefined for a session with no
      // events at all, which falls back to now; there is nothing else to go on
      // and no open period for it to inflate.
      endedAt: getLastEventAt(session.id),
    });
    recovered++;
  }

  if (recovered > 0) triggerBackgroundPush();

  return recovered;
}
