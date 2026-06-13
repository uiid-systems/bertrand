import { register } from "@/cli/router";
import { getSession, updateSessionStatus } from "@/db/queries/sessions";
import { insertEvent } from "@/db/queries/events";
import { getConversation, updateLastQuestion } from "@/db/queries/conversations";
import type { SessionStatus } from "@/db/queries/sessions";
import { triggerBackgroundPush } from "@/sync/trigger";

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

  // Skip redundant status updates — session.working fires on every PreToolUse
  // but is a no-op when already working. Avoids unnecessary DB writes.
  const newStatus = EVENT_STATUS_MAP[event];
  if (newStatus && newStatus === session.status) {
    return;
  }

  // See shouldIgnoreStatusFlip — defends against delayed-hook races where a
  // reparented PreToolUse hook child commits `session.active` after bertrand
  // has finalized the row. The event still gets inserted so the timeline
  // records what the hook tried to say.
  const ignoreStatusFlip = shouldIgnoreStatusFlip(newStatus, session.pid);

  let meta: Record<string, unknown> | undefined;
  if (metaJson) {
    try {
      meta = JSON.parse(metaJson);
    } catch {
      console.error(`Invalid JSON meta: ${metaJson}`);
      process.exit(1);
    }
  }

  // Get conversation ID from meta or env — only use if it exists in DB
  const rawConvoId =
    (meta?.claude_id as string) ||
    process.env.BERTRAND_CLAUDE_ID ||
    undefined;
  const conversationId =
    rawConvoId && getConversation(rawConvoId) ? rawConvoId : undefined;

  // Derive summary fallback. For session.answered, build a joined string from
  // meta.answers values (the new structured shape replaces the legacy meta.answer).
  const answersObj = meta?.answers as Record<string, string> | undefined;
  const joinedAnswers = answersObj
    ? Object.values(answersObj).join(", ") || undefined
    : undefined;

  insertEvent({
    sessionId,
    conversationId,
    event,
    summary:
      summaryArg ||
      (meta?.question as string) ||
      joinedAnswers ||
      undefined,
    meta,
  });

  // Update session status
  if (newStatus && !ignoreStatusFlip) {
    updateSessionStatus(sessionId, newStatus);
  }

  // If this is a waiting event with a question, update conversation's lastQuestion
  if (event === "session.waiting" && conversationId && meta?.question) {
    updateLastQuestion(conversationId, meta.question as string);
  }

  // Eventual cross-machine sync — session.end is the once-per-pause signal the
  // user identified as the natural push boundary. Fire-and-forget; no-op when
  // sync is not configured.
  if (event === "session.end") {
    triggerBackgroundPush();
  }
});
