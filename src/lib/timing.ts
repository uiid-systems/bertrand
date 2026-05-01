import { getEventsBySession, getEventsByType } from "@/db/queries/events";
import { upsertSessionStats } from "@/db/queries/stats";

// --- Types ---

export type TimingType = "claude_work" | "user_wait";

type State = "idle" | "active" | "waiting";

export interface TimingSegment {
  start: string; // ISO timestamp
  end: string;
  durationMs: number;
  type: TimingType;
  claudeId?: string;
}

export interface TimingSummary {
  totalClaudeWorkMs: number;
  totalUserWaitMs: number;
  /** claude_work as percentage of total tracked time (0–100) */
  activePct: number;
  /** Wall-clock duration from first to last event, in seconds */
  durationS: number;
  segments: TimingSegment[];
}

interface EventRow {
  event: string;
  createdAt: string;
  meta?: unknown;
  conversationId?: string | null;
}

// --- State machine ---

function getClaudeId(row: EventRow): string | undefined {
  if (row.conversationId) return row.conversationId;
  const meta = row.meta as Record<string, unknown> | null;
  return (meta?.claude_id as string) ?? undefined;
}

function tsMs(iso: string): number {
  return new Date(iso).getTime();
}

function pushSegment(
  segments: TimingSegment[],
  type: TimingType,
  startIso: string,
  endIso: string,
  claudeId?: string
): void {
  const durationMs = tsMs(endIso) - tsMs(startIso);
  if (durationMs <= 0) return;
  segments.push({ start: startIso, end: endIso, durationMs, type, claudeId });
}

/**
 * Walk a chronologically-ordered event sequence and produce timing segments.
 *
 * Explicit FSM with three states: idle → active → waiting → active (cycle).
 * Only four event types drive transitions:
 *   claude.started    → enter active
 *   session.waiting   → active → waiting  (emit claude_work segment)
 *   session.answered  → waiting → active  (emit user_wait segment)
 *   claude.ended      → close any open period, return to idle
 */
export function computeTimings(events: EventRow[]): TimingSummary {
  const segments: TimingSegment[] = [];
  let state: State = "idle";
  let periodStart: string | null = null;
  let currentClaudeId: string | undefined;

  for (const ev of events) {
    switch (ev.event) {
      case "claude.started": {
        // If we were already working (malformed: double claude.started), close the open period
        if (state === "active" && periodStart) {
          pushSegment(segments, "claude_work", periodStart, ev.createdAt, currentClaudeId);
        }
        // If we were blocked (malformed: claude.started during block), close the wait period
        if (state === "waiting" && periodStart) {
          pushSegment(segments, "user_wait", periodStart, ev.createdAt, currentClaudeId);
        }
        state = "active";
        periodStart = ev.createdAt;
        currentClaudeId = getClaudeId(ev);
        break;
      }

      case "session.waiting": {
        if (state === "active" && periodStart) {
          pushSegment(segments, "claude_work", periodStart, ev.createdAt, currentClaudeId);
        }
        state = "waiting";
        periodStart = ev.createdAt;
        currentClaudeId = getClaudeId(ev) ?? currentClaudeId;
        break;
      }

      case "session.answered": {
        if (state === "waiting" && periodStart) {
          pushSegment(segments, "user_wait", periodStart, ev.createdAt, currentClaudeId);
        }
        state = "active";
        periodStart = ev.createdAt;
        currentClaudeId = getClaudeId(ev) ?? currentClaudeId;
        break;
      }

      case "claude.ended": {
        if (state === "active" && periodStart) {
          pushSegment(segments, "claude_work", periodStart, ev.createdAt, currentClaudeId);
        }
        if (state === "waiting" && periodStart) {
          pushSegment(segments, "user_wait", periodStart, ev.createdAt, currentClaudeId);
        }
        state = "idle";
        periodStart = null;
        currentClaudeId = undefined;
        break;
      }
    }
  }

  // Close any open period (crash / active session without claude.ended)
  const lastEvent = events[events.length - 1];
  if (state !== "idle" && periodStart && lastEvent) {
    if (state === "active") {
      pushSegment(segments, "claude_work", periodStart, lastEvent.createdAt, currentClaudeId);
    } else if (state === "waiting") {
      pushSegment(segments, "user_wait", periodStart, lastEvent.createdAt, currentClaudeId);
    }
  }

  // Summarize
  const totalClaudeWorkMs = segments
    .filter((s) => s.type === "claude_work")
    .reduce((sum, s) => sum + s.durationMs, 0);
  const totalUserWaitMs = segments
    .filter((s) => s.type === "user_wait")
    .reduce((sum, s) => sum + s.durationMs, 0);
  const totalTracked = totalClaudeWorkMs + totalUserWaitMs;
  const activePct = totalTracked > 0 ? Math.round((totalClaudeWorkMs / totalTracked) * 100) : 0;

  // Wall-clock duration from first to last event
  let durationS = 0;
  if (events.length >= 2) {
    const first = tsMs(events[0]!.createdAt);
    const last = tsMs(events[events.length - 1]!.createdAt);
    durationS = Math.round((last - first) / 1000);
  }

  return { totalClaudeWorkMs, totalUserWaitMs, activePct, durationS, segments };
}

// --- DB-wired helpers ---

/**
 * Compute timing from persisted events for a session and upsert into sessionStats.
 * Called at session end.
 */
export function computeAndPersist(sessionId: string): TimingSummary {
  const events = getEventsBySession(sessionId);
  const summary = computeTimings(events);

  const prEvents = getEventsByType(sessionId, "gh.pr.created");
  const conversationIds = new Set(
    events.filter((e) => e.conversationId).map((e) => e.conversationId)
  );
  const interactionCount = events.filter(
    (e) => e.event === "session.waiting" || e.event === "session.answered"
  ).length;

  upsertSessionStats(sessionId, {
    eventCount: events.length,
    conversationCount: conversationIds.size,
    interactionCount,
    prCount: prEvents.length,
    claudeWorkS: Math.round(summary.totalClaudeWorkMs / 1000),
    userWaitS: Math.round(summary.totalUserWaitMs / 1000),
    activePct: summary.activePct,
    durationS: summary.durationS,
  });

  return summary;
}

/**
 * Live timing computation for active sessions (no persisted stats yet).
 * Walks events on demand — use sessionStats fast path when available.
 */
export function computeTimingsLive(sessionId: string): TimingSummary {
  const events = getEventsBySession(sessionId);
  return computeTimings(events);
}
