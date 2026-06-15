import { register } from "@/cli/router";
import { getSession } from "@/db/queries/sessions";
import { getConversation } from "@/db/queries/conversations";
import { getLatestEventOfType } from "@/db/queries/events";
import { emitAssistantMessage, emitAssistantRecap } from "@/db/events/emit";
import { getLatestAssistantTurn } from "@/lib/transcript";

const RECAP_RE = /<recap>([\s\S]*?)<\/recap>/i;
const RECAP_TAG_GLOBAL = /<recap>[\s\S]*?<\/recap>/gi;

function summarize(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

/**
 * Capture the latest assistant turn from the transcript: full message text +
 * the `<recap>` tag if present. Called once per AskUserQuestion (on-waiting.sh)
 * and once at Stop (on-done.sh), so the timeline shows what Claude said at
 * every turn boundary, not just the final one.
 *
 * Deduplication: each call checks the most-recent assistant.message /
 * assistant.recap for this session against the current turn's text. If the
 * content matches, no new event is inserted. This makes the two calling
 * hooks idempotent — Stop's final-turn capture is a no-op when AskUQ already
 * grabbed the same turn (the "Done for now" path).
 */
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

  const fullText = turn.text;
  const textSansRecap = fullText.replace(RECAP_TAG_GLOBAL, "").trim();

  const convoId =
    conversationId && getConversation(conversationId) ? conversationId : undefined;

  // assistant.message — emit if text differs from the most recent one for
  // this session. The dedup is a content match so per-AskUQ + final-Stop
  // calls on the same turn collapse to one event.
  if (textSansRecap || turn.thinkingBlocks > 0) {
    const latestMsg = getLatestEventOfType(sessionId, "assistant.message");
    const latestText = (latestMsg?.meta as Record<string, unknown> | null)?.text;
    if (latestText !== textSansRecap) {
      emitAssistantMessage({
        sessionId,
        conversationId: convoId,
        text: textSansRecap,
        model: turn.model,
        thinkingBlocks: turn.thinkingBlocks,
        thinkingBytes: turn.thinkingBytes,
        summary: textSansRecap ? summarize(textSansRecap) : "thinking only",
      });
    }
  }

  // assistant.recap — same dedup pattern. Only fires for turns that included
  // a `<recap>...</recap>` tag.
  const recapMatch = fullText.match(RECAP_RE);
  const recap = recapMatch?.[1]?.trim();
  if (recap) {
    const latestRecap = getLatestEventOfType(sessionId, "assistant.recap");
    const latestRecapText = (latestRecap?.meta as Record<string, unknown> | null)?.recap;
    if (latestRecapText !== recap) {
      emitAssistantRecap({
        sessionId,
        conversationId: convoId,
        recap,
      });
    }
  }
});
