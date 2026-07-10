import { getActiveSessions, updateSession } from "@/db/queries/sessions";
import { storeSessionSummary } from "@/lib/summary";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect sessions stuck in an active state (active/waiting)
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
      // Crashed sessions never hit a normal pause path — derive their
      // sibling-context summary here so they aren't blank to neighbors.
      storeSessionSummary(session.id);
      recovered++;
    }
  }

  return recovered;
}
