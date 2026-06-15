import { register } from "@/cli/router";
import { getSession, updateSessionStatus } from "@/db/queries/sessions";
import { getConversation, updateLastQuestion } from "@/db/queries/conversations";
import type { SessionStatus } from "@/db/queries/sessions";
import { triggerBackgroundPush } from "@/sync/trigger";
import {
  emitPermissionRequested,
  emitPermissionResolved,
  emitSessionAnswered,
  emitSessionPaused,
  emitSessionRecap,
  emitSessionWaiting,
  emitToolApplied,
  emitUserPrompted,
} from "@/db/events/emit";

/** Status transitions implied by event types */
const EVENT_STATUS_MAP: Record<string, SessionStatus> = {
  "session.waiting": "waiting",
  "session.answered": "active",
  "session.active": "active",
  "session.paused": "paused",
  "session.started": "active",
  "session.end": "paused",
};

/**
 * Refuse status flips to `active`/`waiting` for sessions that have no owning
 * bertrand process (`pid === null`). Guards against the delayed-hook race:
 * Claude's PreToolUse hook can spawn `bertrand update --event session.active`
 * and then get its child reparented to init when Claude is SIGINT'd, so the
 * commit can land after bertrand's finalizeSession set the row to paused —
 * resurrecting the session as "active" with no one alive to manage it.
 */
export function shouldIgnoreStatusFlip(
  newStatus: SessionStatus | undefined,
  sessionPid: number | null,
): boolean {
  if (!newStatus) return false;
  if (newStatus !== "active" && newStatus !== "waiting") return false;
  return sessionPid === null;
}

/**
 * Map a hook-emitted `--event X --meta {…}` invocation to its typed emit
 * helper from `db/events/emit.ts`. This centralizes the schema for every
 * hook-driven event in one place. New event types from hooks must be added
 * here or they'll be rejected.
 *
 * Returns false when the event type is unknown, so the caller can decide
 * how loud to be about it. Bash hooks deliberately stay quiet (see the
 * `bq` wrapper in scripts.ts) so unknown events just disappear.
 */
function dispatchHookEvent(
  event: string,
  ctx: {
    sessionId: string;
    conversationId?: string;
    meta: Record<string, unknown>;
    summary?: string;
  },
): boolean {
  const { sessionId, conversationId, meta, summary } = ctx;
  switch (event) {
    case "user.prompt":
      emitUserPrompted({
        sessionId,
        conversationId,
        prompt: String(meta.prompt ?? ""),
      });
      return true;
    case "session.waiting":
      emitSessionWaiting({
        sessionId,
        conversationId,
        question: String(meta.question ?? "Waiting for input"),
      });
      return true;
    case "session.answered":
      emitSessionAnswered({
        sessionId,
        conversationId,
        answers: (meta.answers as Record<string, unknown>) ?? {},
        annotations: (meta.annotations as Record<string, unknown>) ?? {},
        questions: (meta.questions as Parameters<typeof emitSessionAnswered>[0]["questions"]) ?? [],
      });
      return true;
    case "session.recap":
      emitSessionRecap({
        sessionId,
        conversationId,
        recap: String(meta.recap ?? ""),
      });
      return true;
    case "session.paused":
      emitSessionPaused({ sessionId, conversationId });
      return true;
    case "permission.request":
      emitPermissionRequested({
        sessionId,
        conversationId,
        tool: String(meta.tool ?? ""),
        detail: String(meta.detail ?? ""),
      });
      return true;
    case "permission.resolve":
      emitPermissionResolved({
        sessionId,
        conversationId,
        tool: String(meta.tool ?? ""),
        detail: String(meta.detail ?? ""),
        outcome: meta.outcome === "denied" ? "denied" : "approved",
      });
      return true;
    case "tool.applied":
      emitToolApplied({
        sessionId,
        conversationId,
        summary: summary ?? "edited a file",
        permissions: (meta.permissions as Parameters<typeof emitToolApplied>[0]["permissions"]) ?? [],
      });
      return true;
    default:
      return false;
  }
}

register("update", async (args) => {
  let sessionId = "";
  let event = "";
  let metaJson = "";
  let summaryArg: string | undefined;

  // Parse flags: --session-id <id> --event <type> [--summary <text>] [--meta <json>]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--session-id" && next) {
      sessionId = next;
      i++;
    } else if (arg === "--event" && next) {
      event = next;
      i++;
    } else if (arg === "--summary" && next) {
      summaryArg = next;
      i++;
    } else if (arg === "--meta" && next) {
      metaJson = next;
      i++;
    }
  }

  if (!sessionId || !event) {
    console.error("Usage: bertrand update --session-id <id> --event <type> [--meta <json>]");
    process.exit(1);
  }

  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  // Skip redundant status updates — session.waiting/answered fire frequently
  // and are no-ops when the status is already where we'd flip it to.
  const newStatus = EVENT_STATUS_MAP[event];
  if (newStatus && newStatus === session.status) {
    return;
  }

  // See shouldIgnoreStatusFlip — defends against delayed-hook races where a
  // reparented PostToolUse hook child commits `session.answered` after
  // bertrand has finalized the row. The event still gets inserted so the
  // timeline records what the hook tried to say.
  const ignoreStatusFlip = shouldIgnoreStatusFlip(newStatus, session.pid);

  let meta: Record<string, unknown> = {};
  if (metaJson) {
    try {
      meta = JSON.parse(metaJson) as Record<string, unknown>;
    } catch {
      console.error(`Invalid JSON meta: ${metaJson}`);
      process.exit(1);
    }
  }

  // Resolve the conversation FK: meta.claude_id → env → undefined.
  // Only used if the row actually exists in this project's DB.
  const rawConvoId =
    (meta?.claude_id as string) ||
    process.env.BERTRAND_CLAUDE_ID ||
    undefined;
  const conversationId =
    rawConvoId && getConversation(rawConvoId) ? rawConvoId : undefined;

  const dispatched = dispatchHookEvent(event, {
    sessionId,
    conversationId,
    meta,
    summary: summaryArg,
  });

  if (!dispatched) {
    // Unknown event types are silently dropped — bertrand's hooks are
    // version-controlled, so an unrecognized event is a stale-binary-meets-
    // new-hook situation we don't want to crash on. If the user is debugging
    // they can run the command directly and the missing dispatch will be
    // obvious from the absent DB row.
    return;
  }

  if (newStatus && !ignoreStatusFlip) {
    updateSessionStatus(sessionId, newStatus);
  }

  if (event === "session.waiting" && conversationId && meta?.question) {
    updateLastQuestion(conversationId, meta.question as string);
  }

  if (event === "session.end") {
    triggerBackgroundPush();
  }
});
