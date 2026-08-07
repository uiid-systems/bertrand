import { getActiveSessions, updateSession } from "@/db/queries/sessions";
import { storeSessionSummary } from "@/lib/summary";
import { isRecordedProcessAlive } from "@/lib/process-identity";

/**
 * Detect sessions stuck in an active state (active/waiting) whose owning
 * process is no longer running, and recover them to paused.
 *
 * Liveness is identity-checked, not a bare `kill(pid, 0)` (#209). The pid on a
 * stale row belongs to a process that is already gone, and the OS is free to
 * hand that number to something unrelated; a bare probe would then read the
 * row as live and it would **never** be recovered. Rows written before
 * `pidStartedAt` existed carry no identity, so they fall back to the old
 * liveness-only behavior rather than being declared dead wholesale.
 *
 * Scoped to the active project's DB, which is where every recoverable session
 * lives: the CLI recovers the project it was launched in, and dashboard
 * sessions are always created in serve's active project
 * (`spawnDashboardSession` resolves it). Summary derivation is likewise
 * active-project-bound, so widening this would need db threading through
 * `storeSessionSummary` first.
 *
 * Returns the number of recovered sessions.
 */
export async function recoverStaleSessions(): Promise<number> {
  const active = getActiveSessions();
  let recovered = 0;

  for (const { session } of active) {
    if (!session.pid) continue;
    if (await isRecordedProcessAlive(session.pid, session.pidStartedAt)) continue;

    updateSession(session.id, {
      status: "paused",
      pid: null,
      pidStartedAt: null,
    });
    // Crashed sessions never hit a normal pause path — derive their
    // sibling-context summary here so they aren't blank to neighbors.
    storeSessionSummary(session.id);
    recovered++;
  }

  return recovered;
}
