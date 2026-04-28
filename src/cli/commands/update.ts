import { register } from "@/cli/router";
import { getSession, updateSessionStatus } from "@/db/queries/sessions";
import { insertEvent } from "@/db/queries/events";
import { getConversation, updateLastQuestion } from "@/db/queries/conversations";
import type { SessionStatus } from "@/db/queries/sessions";

/** Status transitions implied by event types */
const EVENT_STATUS_MAP: Record<string, SessionStatus> = {
  "session.waiting": "waiting",
  "session.answered": "active",
  "session.active": "active",
  "session.paused": "paused",
  "session.started": "active",
  "session.end": "paused",
};

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

  // Insert event
  insertEvent({
    sessionId,
    conversationId,
    event,
    summary: summaryArg || (meta?.question as string) || (meta?.answer as string) || undefined,
    meta,
  });

  // Update session status
  if (newStatus) {
    updateSessionStatus(sessionId, newStatus);
  }

  // If this is a waiting event with a question, update conversation's lastQuestion
  if (event === "session.waiting" && conversationId && meta?.question) {
    updateLastQuestion(conversationId, meta.question as string);
  }
});
