/**
 * End-of-session bookkeeping. Lived in `src/engine` until ELKY-176; it is pure
 * DB/stats work with no PTY in it, and both hosts of a session — the CLI
 * launcher and the server — plus crash recovery need it, so it sits in `lib`
 * with the rest of the session lifecycle. See `session-recovery.ts` and
 * `src/layer-boundary.test.ts`.
 */
import { getSession, updateSession } from "@/db/queries/sessions";
import { endConversation, getConversation } from "@/db/queries/conversations";
import { emitClaudeEnded } from "@/db/events/emit";
import { computeAndPersist } from "@/lib/timing";
import { formatDbTime, parseDbTime } from "@/lib/format";
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
  /**
   * When claude actually exited, as a stored timestamp in either shape
   * (`parseDbTime` reads both). Defaults to now — correct for every caller that
   * was standing over the process and watched it go.
   *
   * Recovery is the exception, and the reason this option exists. It notices an
   * adopted session's exit whenever the next `bertrand launch` or `serve`
   * happens to run, which can be days later. `computeTimings` closes the open
   * period at the `claude.ended` event, so stamping the sweep's own clock
   * writes the entire gap into the session as work or wait: a session
   * abandoned five days ago records five days of user_wait, an activePct of 0,
   * and a five-day duration. Passing the last recorded event instead keeps
   * that fabricated tail at zero.
   */
  endedAt?: string;
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

  // Emitted in the `datetime('now')` shape rather than the ISO one the session
  // column uses: the timing FSM compares this event against its neighbours with
  // a bare `new Date()`, which reads the two formats in different zones.
  const endedMs = opts.endedAt ? parseDbTime(opts.endedAt) : Date.now();

  emitClaudeEnded({
    sessionId,
    conversationId: safeConversationId,
    exitCode,
    createdAt: opts.endedAt ? formatDbTime(endedMs) : undefined,
  });

  updateSession(sessionId, {
    status: "paused",
    pid: null,
    pidStartedAt: null,
    // Same shape as `startedAt`, which is a column default. The two are
    // subtracted to get a session's duration, and SQLite's zone-less strings
    // read as local time — so an ISO `endedAt` against a `datetime('now')`
    // `startedAt` came out short by the machine's UTC offset.
    endedAt: formatDbTime(endedMs),
  });
  storeSessionSummary(sessionId);

  pruneSessionMarkers(sessionId, safeConversationId);

  computeAndPersist(sessionId);
  if (opts.stopServerWhenIdle) stopServerIfIdle();

  // Sync push on session end. Detached fire-and-forget — won't block exit.
  if (opts.triggerSyncPush !== false) triggerBackgroundPush();
}
