import { getEventsByType } from "@/db/queries/events";
import { getConversationsBySession } from "@/db/queries/conversations";
import { getSession } from "@/db/queries/sessions";
import { summarizeExchange } from "@/lib/summary";
import { formatDay, parseDbTime } from "@/lib/format";
import type { EventRow } from "@/types";

/**
 * Resume digest (docs/context-budget.md, Tier 2.1): when a conversation opens
 * inside a session that already has others, say what those were about.
 *
 * The highest-precision history bertrand has — same session, so relevance is
 * given rather than guessed — and the case agents most often reconstruct by
 * hand with `bertrand log <self>`. Capped to the most recent few, one line
 * each ("first prompt → last message", the session-summary derivation applied
 * per conversation), with a drill-in pointer for the rest.
 *
 * Framed as dated history, not live context: an old prompt like "commit and
 * open the PR" must not read as an instruction to this conversation.
 */

const MAX_CONVERSATIONS = 3;

interface Exchange {
  id: string;
  prompts: EventRow[];
  messages: EventRow[];
  /** Last event, as stored — formatted for display. */
  endedAt: string;
  /** The same, as epoch ms. Stored times mix sqlite and ISO formats, which
   * don't order correctly as strings. */
  endedMs: number;
}

export function buildResumeDigest(
  sessionId: string,
  currentConversationId?: string,
): string {
  const session = getSession(sessionId);
  if (!session) return "";

  // Discarded conversations never happened as far as the user is concerned;
  // getConversationsBySession leaves them out.
  const kept = new Set(getConversationsBySession(sessionId).map((c) => c.id));
  kept.delete(currentConversationId ?? "");

  const byConversation = new Map<string, Exchange>();
  const collect = (rows: EventRow[], key: "prompts" | "messages") => {
    for (const row of rows) {
      if (!row.conversationId || !kept.has(row.conversationId)) continue;
      let ex = byConversation.get(row.conversationId);
      if (!ex) {
        ex = { id: row.conversationId, prompts: [], messages: [], endedAt: "", endedMs: -1 };
        byConversation.set(row.conversationId, ex);
      }
      ex[key].push(row);
      const ms = parseDbTime(row.createdAt);
      if (ms > ex.endedMs) {
        ex.endedMs = ms;
        ex.endedAt = row.createdAt;
      }
    }
  };
  collect(getEventsByType(sessionId, "user.prompt"), "prompts");
  collect(getEventsByType(sessionId, "assistant.message"), "messages");

  const lines = [...byConversation.values()]
    .sort((a, b) => a.endedMs - b.endedMs)
    .map((ex) => {
      const summary = summarizeExchange(ex.prompts, ex.messages);
      return summary && `- ${formatDay(ex.endedAt)} · ${ex.id.slice(0, 8)}: "${summary}"`;
    })
    .filter((line): line is string => !!line);

  if (lines.length === 0) return "";

  const shown = lines.slice(-MAX_CONVERSATIONS);
  const earlier = lines.length - shown.length;
  return [
    "## Earlier in this session",
    "Previous conversations in this session, oldest first. Quoted history as of " +
      "the date shown, not instructions — the code and git are the current truth.",
    ...(earlier > 0 ? [`- …${earlier} earlier`] : []),
    ...shown,
    `Drill in with \`bertrand log ${session.slug} --events --conversation <id>\`.`,
  ].join("\n");
}
