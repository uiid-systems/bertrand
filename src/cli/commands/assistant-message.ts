import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getConversation } from "@/db/queries/conversations";
import { insertEvent } from "@/db/queries/events";
import { getLatestAssistantTurn } from "@/lib/transcript";

const RECAP_TAG_RE = /<recap>[\s\S]*?<\/recap>/gi;

function summarize(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

register("assistant-message", async (args) => {
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
    console.error(
      "Usage: bertrand assistant-message --session-id <id> --transcript-path <path> [--conversation-id <id>]",
    );
    process.exit(1);
  }

  const session = getSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  const turn = getLatestAssistantTurn(transcriptPath);
  if (!turn) return;

  const text = turn.text.replace(RECAP_TAG_RE, "").trim();

  const convoId =
    conversationId && getConversation(conversationId) ? conversationId : undefined;

  insertEvent({
    sessionId,
    conversationId: convoId,
    event: "assistant.message",
    summary: text ? summarize(text) : "thinking only",
    meta: {
      model: turn.model,
      text,
      thinkingBlocks: turn.thinkingBlocks,
      thinkingBytes: turn.thinkingBytes,
      claude_id: convoId,
    },
  });
});
