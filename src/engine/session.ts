import { randomUUID } from "crypto";
import {
  createSession,
  updateSession,
  getSession,
  getSessionByGroupSlug,
} from "@/db/queries/sessions";
import { createConversation, endConversation } from "@/db/queries/conversations";
import { insertEvent } from "@/db/queries/events";
import { getOrCreateGroupPath, getGroup, getGroupByPath } from "@/db/queries/groups";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { launchClaude } from "./process";
import { computeAndPersist } from "@/lib/timing";

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
 * Returns session ID when the Claude process exits.
 */
export async function launch(opts: LaunchOpts): Promise<string> {
  // Check for duplicate session slug within the target group
  const existingGroup = getGroupByPath(opts.groupPath);
  if (existingGroup) {
    const existing = getSessionByGroupSlug(existingGroup.id, opts.slug);
    if (existing) {
      throw new Error(
        `Session "${opts.slug}" already exists in group "${opts.groupPath}"`
      );
    }
  }

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
  updateSession(session.id, { status: "active", pid: process.pid });

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

  computeAndPersist(session.id);

  return session.id;
}

/**
 * Resume an existing session with a specific conversation.
 * Returns session ID when the Claude process exits.
 */
export async function resume(opts: ResumeOpts): Promise<string> {
  const session = getSession(opts.sessionId);
  if (!session) throw new Error(`Session not found: ${opts.sessionId}`);

  const group = getGroup(session.groupId);
  const sessionName = group ? `${group.path}/${session.slug}` : session.name;
  updateSession(session.id, { status: "active", pid: process.pid });

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

  insertEvent({
    sessionId: session.id,
    event: "session.end",
  });

  computeAndPersist(session.id);

  return session.id;
}
