/**
 * Agent-shaped session digest.
 *
 * `bertrand log <session>` defaults to this view: per-conversation subject,
 * decision trail, files touched, and outcome — the ~3% of the event payload a
 * sibling agent actually needs (see docs/agent-cli.md). Everything derives
 * from existing event rows; no schema involvement.
 *
 * Segmentation extends dashboard/src/lib/timeline/segments.ts: events are
 * grouped by `conversationId`, legacy null-conversationId rows carry forward
 * into the current segment, and — beyond the dashboard's rule — a
 * null-conversation claude.started opens a new segment so pre-tracking
 * sessions keep their conversation boundaries. The dashboard should adopt
 * this module to close that gap (its `@/*` alias already points at `src/`;
 * this module is dependency-free below `@/types` + `@/lib/format`).
 */

import type { EventRow } from "@/types";
import { truncate } from "@/lib/format";

const SUBJECT_MAX = 200;
const PROMPT_MAX = 200;
const DECISION_MAX = 200;
const OUTCOME_MAX = 300;

export type ConversationEvents = {
  /** Conversation UUID, or "unknown-N" for legacy rows that predate tracking. */
  conversationId: string;
  /** 1-based chronological position. */
  ordinal: number;
  events: EventRow[];
};

export type Decision = {
  q: string;
  /** null when the question is still waiting on the user (open sessions). */
  a: string | null;
  at: string;
};

export type ConversationDigest = {
  ordinal: number;
  /** 8-char conversation id prefix — enough for --conversation lookups. */
  id: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  /** First user prompt — the conversation's subject. */
  subject: string | null;
  /** Subsequent user prompts, in order. */
  prompts: string[];
  /** The Q&A trail: every AskUserQuestion and what the user picked. */
  decisions: Decision[];
  filesTouched: string[];
  /** Last assistant message — where the conversation left off. */
  outcome: string | null;
};

/**
 * Group session events into per-conversation segments, in event order.
 *
 * Keyed by `conversationId`; legacy rows with a null id carry forward into
 * the current segment. A `claude.started` with a null conversationId opens a
 * NEW `unknown-N` segment — legacy sessions recorded one claude.started per
 * conversation, so without this boundary every pre-tracking session would
 * collapse into a single segment and Q&A pairs would merge across what were
 * separate conversations.
 */
export function segmentByConversation(events: EventRow[]): ConversationEvents[] {
  type Bucket = { conversationId: string; events: EventRow[] };
  const buckets: Bucket[] = [];
  let current: Bucket | null = null;
  let unknownCount = 0;

  for (const ev of events) {
    let key: string;
    if (ev.conversationId) {
      key = ev.conversationId;
    } else if (ev.event === "claude.started" || !current) {
      key = `unknown-${++unknownCount}`;
    } else {
      key = current.conversationId;
    }
    if (!current || current.conversationId !== key) {
      current = { conversationId: key, events: [] };
      buckets.push(current);
    }
    current.events.push(ev);
  }

  return buckets.map((b, i) => ({
    conversationId: b.conversationId,
    ordinal: i + 1,
    events: b.events,
  }));
}

function metaStr(ev: EventRow, key: string): string {
  const value = ev.meta?.[key];
  return typeof value === "string" ? value : "";
}

/** Join the values of a session.answered `answers` record. */
function joinAnswers(ev: EventRow): string {
  const answers = ev.meta?.answers;
  if (!answers || typeof answers !== "object") return "";
  return Object.values(answers as Record<string, unknown>)
    .map((v) => String(v))
    .join(", ");
}

/** File paths from a tool.applied event's permissions payload. */
function appliedFiles(ev: EventRow): string[] {
  const permissions = ev.meta?.permissions;
  if (!Array.isArray(permissions)) return [];
  return permissions
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>).detail : ""))
    .filter((d): d is string => typeof d === "string" && d.length > 0);
}

/**
 * Strip the session's working directory from an absolute path so digests read
 * repo-relative. Best-effort: worktree moves change cwd mid-session, in which
 * case unmatched paths stay absolute.
 */
function relativize(path: string, cwd: string | null): string {
  if (cwd && path.startsWith(cwd + "/")) return path.slice(cwd.length + 1);
  return path;
}

export function digestConversation(segment: ConversationEvents): ConversationDigest {
  const { events, ordinal, conversationId } = segment;

  let subject: string | null = null;
  const prompts: string[] = [];
  const decisions: Decision[] = [];
  const files: string[] = [];
  let outcome: string | null = null;
  let cwd: string | null = null;
  let pending: { q: string; at: string } | null = null;

  for (const ev of events) {
    switch (ev.event) {
      case "claude.started":
        cwd ??= metaStr(ev, "cwd") || null;
        break;
      case "user.prompt": {
        const prompt = metaStr(ev, "prompt");
        if (!prompt) break;
        if (subject === null) subject = truncate(prompt, SUBJECT_MAX);
        else prompts.push(truncate(prompt, PROMPT_MAX));
        break;
      }
      case "session.waiting":
        // A question superseded by another question was dismissed unanswered
        // — record it as an open decision instead of silently dropping it.
        if (pending) {
          decisions.push({ q: truncate(pending.q, DECISION_MAX), a: null, at: pending.at });
        }
        pending = { q: metaStr(ev, "question") || ev.summary || "", at: ev.createdAt };
        break;
      case "session.answered": {
        const a = truncate(joinAnswers(ev), DECISION_MAX);
        decisions.push({
          q: truncate(pending?.q ?? "", DECISION_MAX),
          a,
          at: ev.createdAt,
        });
        pending = null;
        break;
      }
      case "tool.applied":
        files.push(...appliedFiles(ev));
        break;
      case "assistant.message": {
        // Only meta.text counts. The transcript flush emits "thinking only"
        // events with text:"" and summary:"thinking only" — falling back to
        // the summary would let them overwrite the real last message. The
        // summary fallback applies only to pre-cursor rows with no text key.
        const hasTextKey =
          !!ev.meta && typeof ev.meta === "object" && "text" in (ev.meta as object);
        const text = hasTextKey ? metaStr(ev, "text") : (ev.summary ?? "");
        if (text) outcome = truncate(text, OUTCOME_MAX);
        break;
      }
    }
  }

  // A waiting with no answer yet is the conversation's open question.
  if (pending) {
    decisions.push({ q: truncate(pending.q, DECISION_MAX), a: null, at: pending.at });
  }

  const filesTouched = [...new Set(files.map((f) => relativize(f, cwd)))];

  return {
    ordinal,
    id: conversationId.startsWith("unknown") ? conversationId : conversationId.slice(0, 8),
    startedAt: events[0]?.createdAt ?? "",
    endedAt: events[events.length - 1]?.createdAt ?? "",
    eventCount: events.length,
    subject,
    prompts,
    decisions,
    filesTouched,
    outcome,
  };
}

/** Full digest: segment, then digest each conversation. */
export function digestSession(events: EventRow[]): ConversationDigest[] {
  return segmentByConversation(events).map(digestConversation);
}
