import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getConversation } from "@/db/queries/conversations";
import { emitContextSnapshot } from "@/db/events/emit";
import { getContextSnapshot } from "@/lib/transcript";

register("snapshot", async (args) => {
  let sessionId = "";
  let transcriptPath = "";
  let conversationId = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--session-id" && next) {
      sessionId = next;
      i++;
    } else if (arg === "--transcript-path" && next) {
      transcriptPath = next;
      i++;
    } else if (arg === "--conversation-id" && next) {
      conversationId = next;
      i++;
    }
  }

  if (!sessionId || !transcriptPath) {
    console.error("Usage: bertrand snapshot --session-id <id> --transcript-path <path> [--conversation-id <id>]");
    process.exit(1);
  }

  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const snapshot = getContextSnapshot(transcriptPath);
  if (!snapshot) return; // file missing or no assistant turns — silent no-op

  const convoId = conversationId && getConversation(conversationId)
    ? conversationId
    : undefined;

  emitContextSnapshot({
    sessionId,
    conversationId: convoId,
    model: snapshot.model,
    inputTokens: snapshot.inputTokens,
    cacheCreationTokens: snapshot.cacheCreationTokens,
    cacheReadTokens: snapshot.cacheReadTokens,
    totalContextTokens: snapshot.totalContextTokens,
    remainingPct: snapshot.remainingPct,
  });
});
