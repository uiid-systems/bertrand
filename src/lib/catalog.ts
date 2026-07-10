// --- Event types ---

const EVENT_TYPES = [
  "claude.started",
  "claude.ended",
  "claude.discarded",
  "session.waiting",
  "session.answered",
  "user.prompt",
  "tool.used",
  "tool.work",
  "tool.applied",
  "assistant.message",
  "worktree.entered",
  "worktree.exited",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// --- Catalog ---

export type EventCategory = "lifecycle" | "work" | "interaction";

export interface EventInfo {
  label: string;
  category: EventCategory;
  /** ANSI 256-color code */
  color: number;
  /** ANSI 256-color code for detail text */
  detailColor: number;
  /** If true, omit from compact timelines */
  skip: boolean;
}

const catalog = {
  "claude.started": { label: "claude started", category: "lifecycle", color: 35, detailColor: 245, skip: false },
  "claude.ended": { label: "claude ended", category: "lifecycle", color: 35, detailColor: 245, skip: false },
  "claude.discarded": { label: "discarded", category: "lifecycle", color: 245, detailColor: 245, skip: false },
  "session.waiting": { label: "waiting", category: "interaction", color: 33, detailColor: 245, skip: false },
  "session.answered": { label: "answered", category: "interaction", color: 36, detailColor: 245, skip: false },
  "user.prompt": { label: "prompt", category: "interaction", color: 36, detailColor: 245, skip: false },
  "tool.used": { label: "tool", category: "work", color: 214, detailColor: 245, skip: false },
  "tool.work": { label: "tool work", category: "work", color: 214, detailColor: 245, skip: false },
  "tool.applied": { label: "applied", category: "work", color: 214, detailColor: 245, skip: false },
  "assistant.message": { label: "claude", category: "interaction", color: 39, detailColor: 245, skip: false },
  "worktree.entered": { label: "worktree entered", category: "lifecycle", color: 78, detailColor: 245, skip: false },
  "worktree.exited": { label: "worktree exited", category: "lifecycle", color: 245, detailColor: 245, skip: false },
} satisfies Record<EventType, EventInfo>;

const DEFAULT_INFO: EventInfo = {
  label: "unknown",
  category: "lifecycle",
  color: 245,
  detailColor: 245,
  skip: false,
};

export function lookup(eventType: string): EventInfo {
  return (catalog as Record<string, EventInfo>)[eventType] ?? DEFAULT_INFO;
}

// --- Enrichment ---

export interface EnrichedEvent {
  id?: number;
  sessionId: string;
  conversationId?: string | null;
  event: string;
  createdAt: string;
  meta?: unknown;
  /** Display label from catalog */
  label: string;
  /** Event category */
  category: EventCategory;
  /** ANSI 256-color code */
  color: number;
  /** Detail color */
  detailColor: number;
  /** Human-readable summary extracted from meta */
  summary: string;
  /** Claude conversation ID extracted from meta or conversationId */
  claudeId?: string;
}

interface EventRow {
  id?: number;
  sessionId: string;
  conversationId?: string | null;
  event: string;
  createdAt: string;
  summary?: string | null;
  meta?: unknown;
}

function extractClaudeId(row: EventRow): string | undefined {
  if (row.conversationId) return row.conversationId;
  const meta = row.meta as Record<string, unknown> | null;
  return (meta?.claude_id as string) ?? undefined;
}

function extractSummary(row: EventRow): string {
  if (row.summary) return row.summary;

  const meta = row.meta as Record<string, unknown> | null;
  if (!meta) return "";

  switch (row.event) {
    case "session.waiting":
      return (meta.question as string) ?? "";
    case "session.answered": {
      const answers = meta.answers as Record<string, string> | undefined;
      return answers ? Object.values(answers).join(", ") : "";
    }
    case "user.prompt":
      return (meta.prompt as string) ?? "";
    case "worktree.entered":
    case "worktree.exited":
      return (meta.branch as string) ?? (meta.path as string) ?? "";
    default:
      return "";
  }
}

export function enrich(row: EventRow): EnrichedEvent {
  const info = lookup(row.event);
  return {
    id: row.id,
    sessionId: row.sessionId,
    conversationId: row.conversationId,
    event: row.event,
    createdAt: row.createdAt,
    meta: row.meta,
    label: info.label,
    category: info.category,
    color: info.color,
    detailColor: info.detailColor,
    summary: extractSummary(row),
    claudeId: extractClaudeId(row),
  };
}

export function enrichAll(rows: EventRow[]): EnrichedEvent[] {
  return rows.map(enrich);
}
