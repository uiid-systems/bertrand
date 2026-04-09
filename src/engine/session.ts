import { randomUUID } from "crypto";
import { createSession, updateSession, getSession } from "../db/queries/sessions.ts";
import { createConversation, endConversation } from "../db/queries/conversations.ts";
import { insertEvent } from "../db/queries/events.ts";
import { getOrCreateGroupPath, getGroup } from "../db/queries/groups.ts";
import { buildContract } from "../contract/template.ts";
import { buildSiblingContext } from "../contract/context.ts";
import { launchClaude } from "./process.ts";
import { paths } from "../lib/paths.ts";

export interface LaunchOpts {
  /** Group path, e.g. "uiid/bertrand" */
  groupPath: string;
  /** Session slug, e.g. "fix-auth-bug" */
  slug: string;
  /** Display name (defaults to slug) */
  name?: string;
}

export interface ResumeOpts {
  sessionId: string;
  conversationId: string;
}

/**
 * Create a new session and launch Claude.
 * Returns when the Claude process exits.
 */
export async function launch(opts: LaunchOpts): Promise<void> {
  const groupId = getOrCreateGroupPath(opts.groupPath);
  const session = createSession({
    groupId,
    slug: opts.slug,
    name: opts.name ?? opts.slug,
  });

  const claudeId = randomUUID();
  const conversation = createConversation({
    id: claudeId,
    sessionId: session.id,
  });

  // Update session to working with PID
  updateSession(session.id, { status: "working", pid: process.pid });

  // Log start events
  insertEvent({
    sessionId: session.id,
    conversationId: claudeId,
    event: "session.started",
  });
  insertEvent({
    sessionId: session.id,
    conversationId: claudeId,
    event: "claude.started",
    meta: { claude_id: claudeId },
  });

  // Build contract with context
  const sessionName = `${opts.groupPath}/${opts.slug}`;
  const siblingContext = buildSiblingContext(groupId, session.id);
  const contract = buildContract(sessionName, siblingContext);

  // Launch Claude
  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId,
    sessionName,
    contract,
  });

  // Cleanup
  endConversation(claudeId);
  insertEvent({
    sessionId: session.id,
    conversationId: claudeId,
    event: "claude.ended",
    meta: { claude_id: claudeId, exit_code: exitCode },
  });

  updateSession(session.id, {
    status: "paused",
    pid: null,
    endedAt: new Date().toISOString(),
  });

  insertEvent({
    sessionId: session.id,
    event: "session.end",
  });
}

/**
 * Resume an existing session with a specific conversation.
 * Returns when the Claude process exits.
 */
export async function resume(opts: ResumeOpts): Promise<void> {
  const session = getSession(opts.sessionId);
  if (!session) throw new Error(`Session not found: ${opts.sessionId}`);

  const group = getGroup(session.groupId);
  const sessionName = group ? `${group.path}/${session.slug}` : session.name;
  updateSession(session.id, { status: "working", pid: process.pid });

  insertEvent({
    sessionId: session.id,
    conversationId: opts.conversationId,
    event: "session.resumed",
    meta: { claude_id: opts.conversationId },
  });

  // Build contract
  const siblingContext = buildSiblingContext(session.groupId, session.id);
  const contract = buildContract(sessionName, siblingContext);

  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId: opts.conversationId,
    sessionName,
    contract,
    resume: true,
  });

  endConversation(opts.conversationId);
  insertEvent({
    sessionId: session.id,
    conversationId: opts.conversationId,
    event: "claude.ended",
    meta: { claude_id: opts.conversationId, exit_code: exitCode },
  });

  updateSession(session.id, {
    status: "paused",
    pid: null,
    endedAt: new Date().toISOString(),
  });
}
