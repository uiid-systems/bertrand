import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getConversation } from "@/db/queries/conversations";
import { ingestTranscript } from "@/db/events/ingest";

/**
 * Ingest new assistant output from a conversation transcript (see
 * db/events/ingest.ts for the cursor mechanics). Most ticks ride along on
 * `bertrand update --transcript-path …`; this standalone command exists for
 * the Stop hook, which has no unconditional update call on its nudge path
 * but still needs to flush the turn's trailing output.
 */
register("ingest-transcript", async (args) => {
  let sessionId = "";
  let transcriptPath = "";
  let conversationId = "";
  let flush = false;

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
    } else if (arg === "--flush") {
      flush = true;
    }
  }

  if (!sessionId || !transcriptPath) {
    console.error(
      "Usage: bertrand ingest-transcript --session-id <id> --transcript-path <path> [--conversation-id <id>] [--flush]",
    );
    process.exit(1);
  }

  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const convoId =
    conversationId && getConversation(conversationId) ? conversationId : undefined;

  ingestTranscript({
    sessionId,
    conversationId: convoId,
    transcriptPath,
    flush,
  });
});
