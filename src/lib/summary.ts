/**
 * Mechanical session summary, derived at pause time (docs/agent-cli.md, Spec 2).
 *
 * `sessions.summary` feeds the sibling-context block injected into every
 * session's contract — it's how sessions know what their neighbors contain
 * without pulling a log. The derivation is deliberately LLM-free and
 * zero-user-steps: the agent's last message already leads with the outcome
 * (harness convention), so "first prompt → last assistant message" reads as
 * "what was asked → where it ended up".
 *
 * Constraint that shapes this design: after the user picks "Done for now",
 * the answered-hook emits {"continue": false} and the agent never gets
 * another turn — so a summary can't be requested from the agent at exit; it
 * has to be derived from what's already recorded.
 */

import { getEdgeEventOfType } from "@/db/queries/events";
import { setSessionSummary } from "@/db/queries/sessions";
import { truncate } from "@/lib/format";

const SUBJECT_MAX = 120;
const OUTCOME_MAX = 180;

/** Collapse whitespace runs so multi-line prompts read as one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function metaStr(meta: Record<string, unknown> | null, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * "<first prompt> → <last assistant message>", either side optional.
 * Null when the session has neither (nothing worth saying).
 */
export function deriveSessionSummary(sessionId: string): string | null {
  const firstPrompt = getEdgeEventOfType(sessionId, "user.prompt", "first");
  const lastMessage = getEdgeEventOfType(sessionId, "assistant.message", "last");

  const subject = truncate(oneLine(metaStr(firstPrompt?.meta ?? null, "prompt")), SUBJECT_MAX);
  const outcome = truncate(oneLine(metaStr(lastMessage?.meta ?? null, "text")), OUTCOME_MAX);

  if (subject && outcome) return `${subject} → ${outcome}`;
  return subject || outcome || null;
}

/**
 * Derive and persist. Overwrites on every pause so the summary tracks the
 * latest state; skips the write when nothing can be derived so an existing
 * summary is never clobbered with null. Never throws — every caller is on a
 * session-teardown path where a summary failure must not break the exit.
 */
export function storeSessionSummary(sessionId: string): void {
  try {
    const summary = deriveSessionSummary(sessionId);
    if (summary) setSessionSummary(sessionId, summary);
  } catch {
    // Best-effort by design.
  }
}
