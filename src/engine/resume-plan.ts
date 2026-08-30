import { randomUUID } from "crypto";
import { getSession } from "@/db/queries/sessions";
import {
  createConversation,
  getConversationsBySession,
} from "@/db/queries/conversations";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { helpText } from "@/cli/help";
import { claudeSessionExists } from "@/lib/transcript";
import type { SessionRow } from "@/types";

/**
 * Everything a host needs to resume a session, resolved once and shared by both
 * hosts (#214).
 *
 * The CLI (`session.ts:resume`) and the server (`dashboard-session.ts`) differ
 * only in *how* they run `claude` — a foreground PTY that owns the terminal
 * versus a server-owned one the browser attaches to. The decisions before that
 * point are identical, and two copies of them is exactly the divergence that
 * bit #208 (two finalize implementations) and that #209 collapsed back onto a
 * shared path. So the decisions live here and the hosts own only the spawn.
 */
export interface ResumePlan {
  session: SessionRow;
  /** Canonical session name (the slug), as the contract and env expect it. */
  sessionName: string;
  contract: string;
  conversationId: string;
  /**
   * Whether to launch with `--resume <id>` rather than `--session-id <id>`.
   *
   * False when Claude has no transcript for this conversation, which happens
   * for a freshly minted conversation and for a session the user exited before
   * any message was persisted. `claude --resume` fails outright on those with
   * "No conversation found with session ID", so the fallback starts a fresh
   * Claude session under the *same* UUID and bertrand's event linkage holds.
   */
  resumeExisting: boolean;
}

export type ResumePlanResult =
  | { ok: true; plan: ResumePlan }
  | { ok: false; reason: "not-found" | "conversation-not-found" };

/** Mint a new conversation under an existing session. */
export function newConversation(sessionId: string): string {
  const id = randomUUID();
  createConversation({ id, sessionId });
  return id;
}

/** A session's canonical name is its slug — sessions are flat (ELKY-171). */
export function resolveSessionName(session: SessionRow): string {
  return session.slug;
}

/**
 * Build the plan for resuming `sessionId`.
 *
 * `conversationId` omitted mints a new conversation — the equivalent of the
 * resume picker's "+ New conversation".
 *
 * **`cwd` is required and is not optional sugar.** Claude derives a
 * transcript's location from the working directory, so `claudeSessionExists`
 * answers a different question depending on where it is asked from. The CLI
 * could rely on `process.cwd()` because it *is* the session's directory; the
 * server's cwd is an inherited accident with no relation to the session. Left
 * to default, every server-side resume would fail to find the transcript,
 * silently downgrade to `--session-id`, and hand the user a blank conversation
 * wearing the old one's id.
 */
export function planResume(opts: {
  sessionId: string;
  conversationId?: string;
  cwd: string;
}): ResumePlanResult {
  const session = getSession(opts.sessionId);
  if (!session) return { ok: false, reason: "not-found" };

  let conversationId = opts.conversationId;
  if (conversationId) {
    // Scoped to the session on purpose: resuming session A under a
    // conversation belonging to session B would attach B's transcript to A's
    // event stream. getConversationsBySession also excludes discarded rows.
    const owned = getConversationsBySession(opts.sessionId).some(
      (c) => c.id === conversationId,
    );
    if (!owned) return { ok: false, reason: "conversation-not-found" };
  } else {
    conversationId = newConversation(opts.sessionId);
  }

  const sessionName = resolveSessionName(session);

  return {
    ok: true,
    plan: {
      session,
      sessionName,
      contract: buildContract(
        sessionName,
        helpText({ agent: true }),
        buildSiblingContext(session.id),
      ),
      conversationId,
      resumeExisting: claudeSessionExists(conversationId, opts.cwd),
    },
  };
}
