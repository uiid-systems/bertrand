import { getActiveSessions, updateSession } from "../db/queries/sessions.ts";
import { insertEvent } from "../db/queries/events.ts";

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect sessions stuck in an active state (working/blocked/prompting)
 * whose owning process is no longer running, and recover them to paused.
 *
 * Returns the number of recovered sessions.
 */
export function recoverStaleSessions(): number {
  const active = getActiveSessions();
  let recovered = 0;

  for (const { session } of active) {
    if (session.pid && !isProcessAlive(session.pid)) {
      updateSession(session.id, {
        status: "paused",
        pid: null,
      });

      insertEvent({
        sessionId: session.id,
        event: "session.paused",
        summary: "Recovered from stale state (process not found)",
        meta: { stale_pid: session.pid },
      });

      recovered++;
    }
  }

  return recovered;
}
