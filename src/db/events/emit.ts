/**
 * Typed emit helpers for every event the system records.
 *
 * Why this exists: until now, every callsite called `insertEvent({ event: "…",
 * meta: { … } })` with ad-hoc strings and object shapes. The meta-key naming
 * drifted (snake_case from engine, mixed casing from hooks), event names were
 * easy to typo, and there was no single place to see the contract for any
 * given event type. This file is now the source of truth.
 *
 * Caller convention: every helper takes TypeScript-idiomatic camelCase fields.
 * The mapping to the current on-disk meta shape (which still has snake_case
 * leftovers from earlier emit code) lives inside each helper. Renaming the
 * stored shape is a follow-up — but it can happen here alone now, instead of
 * via grep across the whole tree.
 *
 * Bash hooks still go through `bertrand update --event X --meta {…}`. The
 * `update` command resolves the string to the corresponding helper, so the
 * bash → bertrand boundary is also routed through this file (see
 * `src/cli/commands/update.ts`).
 */

import { insertEvent } from "@/db/queries/events";

type EventTarget = {
  sessionId: string;
  conversationId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle — bertrand engine owns these
// ─────────────────────────────────────────────────────────────────────────────

export function emitSessionStarted(args: EventTarget & {
  categoryPath: string;
  sessionName: string;
  sessionSlug: string;
  labels: string[];
  summary?: string | null;
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "session.started",
    meta: {
      category_path: args.categoryPath,
      session_name: args.sessionName,
      session_slug: args.sessionSlug,
      labels: args.labels,
      summary: args.summary ?? null,
    },
  });
}

export function emitSessionResumed(args: EventTarget) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "session.resumed",
    meta: { claude_id: args.conversationId },
  });
}

/** Hook-emitted (on-done.sh). Engine signals end-of-session via emitSessionEnded. */
export function emitSessionPaused(args: EventTarget) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "session.paused",
    meta: { claude_id: args.conversationId },
  });
}

/** Engine-emitted recovery (stale process detected). Distinct semantics from emitSessionPaused. */
export function emitSessionPausedByRecovery(args: EventTarget & { stalePid: number }) {
  return insertEvent({
    sessionId: args.sessionId,
    event: "session.paused",
    summary: "Recovered from stale state (process not found)",
    meta: { stale_pid: args.stalePid },
  });
}

export function emitSessionEnded(args: { sessionId: string }) {
  return insertEvent({
    sessionId: args.sessionId,
    event: "session.end",
  });
}

export function emitClaudeStarted(args: EventTarget & {
  model: string | undefined;
  claudeVersion: string | undefined;
  git: unknown;
  cwd: string;
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "claude.started",
    meta: {
      claude_id: args.conversationId,
      model: args.model,
      claude_version: args.claudeVersion,
      git: args.git,
      cwd: args.cwd,
    },
  });
}

export function emitClaudeEnded(args: EventTarget & { exitCode: number }) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "claude.ended",
    meta: { claude_id: args.conversationId, exit_code: args.exitCode },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction — hook-emitted
// ─────────────────────────────────────────────────────────────────────────────

export function emitUserPrompted(args: EventTarget & { prompt: string }) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "user.prompt",
    meta: { prompt: args.prompt, claude_id: args.conversationId },
  });
}

export function emitSessionWaiting(args: EventTarget & { question: string }) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "session.waiting",
    summary: args.question,
    meta: { question: args.question, claude_id: args.conversationId },
  });
}

type AskUserQuestionDef = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
};

export function emitSessionAnswered(args: EventTarget & {
  answers: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  questions?: AskUserQuestionDef[];
}) {
  const joinedAnswers = Object.values(args.answers)
    .map((v) => String(v))
    .join(", ") || undefined;

  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "session.answered",
    summary: joinedAnswers,
    meta: {
      answers: args.answers,
      annotations: args.annotations ?? {},
      questions: args.questions ?? [],
      claude_id: args.conversationId,
    },
  });
}

/** Promoted from the "Done for now" option description on the last AskUQ. */
export function emitSessionRecap(args: EventTarget & { recap: string }) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "session.recap",
    summary: args.recap.slice(0, 200),
    meta: { recap: args.recap, claude_id: args.conversationId },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Work / permissions — hook-emitted
// ─────────────────────────────────────────────────────────────────────────────

export function emitPermissionRequested(args: EventTarget & {
  tool: string;
  detail: string;
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "permission.request",
    meta: {
      tool: args.tool,
      detail: args.detail,
      claude_id: args.conversationId,
    },
  });
}

export function emitPermissionResolved(args: EventTarget & {
  tool: string;
  detail: string;
  outcome: "approved" | "denied";
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "permission.resolve",
    meta: {
      tool: args.tool,
      detail: args.detail,
      outcome: args.outcome,
      claude_id: args.conversationId,
    },
  });
}

type ToolDiff = {
  oldStr?: string;
  newStr?: string;
  edits?: Array<{ oldStr: string; newStr: string }>;
};

type ToolPermission = {
  tool: string;
  detail: string;
  outcome: "applied";
  count: number;
} & ToolDiff;

/**
 * Records every tool Claude invokes — not just Edit/Write/MultiEdit (which
 * `emitToolApplied` covers). The distinction:
 *   - `tool.applied` fires for tools that mutate files; meta carries diffs.
 *   - `tool.used` fires for the read-only / shell-shaped tools we previously
 *     missed entirely (auto-approved Read, Grep, Glob, etc., and Bash when
 *     no permission prompt was required). The timeline stays comprehensible
 *     because dashboard compact-mode rolls these into tool.work batches.
 *
 * `outcome` distinguishes the permission path:
 *   - `auto`     — tool ran without ever prompting the user
 *   - `approved` — user was prompted (a permission.request fired) and approved
 *
 * Denials don't reach PostToolUse, so they never emit tool.used. Inferred by
 * looking for a permission.request without a matching tool.used.
 */
export function emitToolUsed(args: EventTarget & {
  tool: string;
  detail: string;
  outcome: "auto" | "approved";
}) {
  const summary = formatToolSummary(args.tool, args.detail);
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "tool.used",
    summary,
    meta: {
      tool: args.tool,
      detail: args.detail,
      outcome: args.outcome,
      claude_id: args.conversationId,
    },
  });
}

/** Used by emitToolUsed; also exposed for the dashboard's renderer. */
export function formatToolSummary(tool: string, detail: string): string {
  if (!detail) return tool;
  switch (tool) {
    case "Bash":
      return `ran \`${detail.slice(0, 120)}\``;
    case "Read":
      return `read ${detail}`;
    case "Glob":
    case "Grep":
      return `${tool.toLowerCase()} ${detail}`;
    case "TodoWrite":
      return "updated todos";
    case "WebFetch":
      return `fetched ${detail}`;
    case "WebSearch":
      return `searched: ${detail}`;
    default:
      return `${tool}: ${detail}`;
  }
}

export function emitToolApplied(args: EventTarget & {
  summary: string;
  permissions: ToolPermission[];
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "tool.applied",
    summary: args.summary,
    meta: {
      permissions: args.permissions,
      outcome: "applied",
      claude_id: args.conversationId,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Assistant — what Claude said / thought
// ─────────────────────────────────────────────────────────────────────────────

export function emitAssistantMessage(args: EventTarget & {
  text: string;
  model: string;
  thinkingBlocks: number;
  thinkingBytes: number;
  summary?: string;
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "assistant.message",
    summary: args.summary,
    meta: {
      model: args.model,
      text: args.text,
      thinkingBlocks: args.thinkingBlocks,
      thinkingBytes: args.thinkingBytes,
      claude_id: args.conversationId,
    },
  });
}

export function emitAssistantRecap(args: EventTarget & { recap: string }) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "assistant.recap",
    summary: args.recap.length > 80 ? `${args.recap.slice(0, 77)}...` : args.recap,
    meta: { recap: args.recap, claude_id: args.conversationId },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Context / metering
// ─────────────────────────────────────────────────────────────────────────────

export function emitContextSnapshot(args: EventTarget & {
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalContextTokens: number;
  remainingPct: number;
}) {
  return insertEvent({
    sessionId: args.sessionId,
    conversationId: args.conversationId,
    event: "context.snapshot",
    summary: `${args.remainingPct}% remaining`,
    meta: {
      model: args.model,
      input_tokens: String(args.inputTokens),
      cache_creation_tokens: String(args.cacheCreationTokens),
      cache_read_tokens: String(args.cacheReadTokens),
      context_window_tokens: String(args.totalContextTokens),
      remaining_pct: String(args.remainingPct),
      claude_id: args.conversationId,
    },
  });
}
