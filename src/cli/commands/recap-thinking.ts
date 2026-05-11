import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getConversation } from "@/db/queries/conversations";
import { insertEvent } from "@/db/queries/events";
import { getLatestAssistantTurn } from "@/lib/transcript";

const RECAP_RE = /<recap>([\s\S]*?)<\/recap>/i;

register("recap-thinking", async (args) => {
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
      "Usage: bertrand recap-thinking --session-id <id> --transcript-path <path> [--conversation-id <id>]",
    );
    process.exit(1);
  }

  if (!getSession(sessionId)) return;

  const turn = getLatestAssistantTurn(transcriptPath);
  if (!turn?.text) return;

  const match = turn.text.match(RECAP_RE);
  const recap = match?.[1]?.trim();
  if (!recap) return;

  const convoId =
    conversationId && getConversation(conversationId) ? conversationId : undefined;

  insertEvent({
    sessionId,
    conversationId: convoId,
    event: "assistant.recap",
    summary: recap.length > 80 ? `${recap.slice(0, 77)}...` : recap,
    meta: { recap, claude_id: convoId },
  });
});
