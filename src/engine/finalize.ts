import { getSession, updateSession } from "@/db/queries/sessions";
import { endConversation, getConversation } from "@/db/queries/conversations";
import { emitClaudeEnded } from "@/db/events/emit";
import { computeAndPersist } from "@/lib/timing";
import { storeSessionSummary } from "@/lib/summary";
import { stopServerIfIdle } from "@/lib/server-lifecycle";
import { triggerBackgroundPush } from "@/sync/trigger";
import { pruneSessionMarkers } from "@/hooks/runtime";

export interface FinalizeSessionOptions {
  /**
   * Whether to shut the shared server down once no sessions remain.
   *
   * True for a CLI process, which owns neither the server nor any other
   * session. **False when called from inside `bertrand serve`** — there it
   * would SIGTERM the very process running this code, taking down every other
   * dashboard-owned session and any attached browser with it.
   */
  stopServerWhenIdle: boolean;
  /**
   * Whether to kick a background sync push. Defaults to true — a session
   * ending is exactly when a push should happen.
   *
   * Set false when finalizing several sessions in a loop (crash recovery):
   * `triggerBackgroundPush` has no debounce and spawns a detached
   * `bertrand sync push` per call, so N recovered sessions would spawn N
   * sync processes at once. The caller pushes once when it's done instead.
   */
  triggerSyncPush?: boolean;
}

/**
 * End-of-Claude cleanup, shared by both ways a session can be hosted: a CLI
 * process (`session.ts`) and the server itself (`dashboard-session.ts`).
 *
 * Deliberately one implementation. These two paths previously each had their
 * own, and the server's silently skipped summaries, timing, marker pruning and
 * sync push — a session that ran in the dashboard was blank to its neighbors
 * and absent from stats.
 *
 * Runs defensively: if the session or conversation row was deleted while Claude
 * was running (a parallel bertrand instance, a manual delete), skip the writes
 * that would violate FK constraints rather than crashing the caller.
 */
export function finalizeSessionRow(
  sessionId: string,
  conversationId: string,
  exitCode: number,
  opts: FinalizeSessionOptions,
): void {
  if (!getSession(sessionId)) return;

  const conversationExists = !!getConversation(conversationId);
  const safeConversationId = conversationExists ? conversationId : undefined;

  if (conversationExists) {
    endConversation(conversationId);
  }

  emitClaudeEnded({
    sessionId,
    conversationId: safeConversationId,
    exitCode,
  });

  updateSession(sessionId, {
    status: "paused",
    pid: null,
    pidStartedAt: null,
    endedAt: new Date().toISOString(),
  });
  storeSessionSummary(sessionId);

  pruneSessionMarkers(sessionId, safeConversationId);

  computeAndPersist(sessionId);
  if (opts.stopServerWhenIdle) stopServerIfIdle();

  // Sync push on session end. Detached fire-and-forget — won't block exit.
  if (opts.triggerSyncPush !== false) triggerBackgroundPush();
}
