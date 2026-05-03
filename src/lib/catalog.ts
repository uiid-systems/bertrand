// --- Event types ---

const EVENT_TYPES = [
  "session.started",
  "session.resumed",
  "session.end",
  "claude.started",
  "claude.ended",
  "claude.discarded",
  "session.waiting",
  "session.answered",
  "permission.request",
  "permission.resolve",
  "worktree.entered",
  "worktree.exited",
  "gh.pr.created",
  "gh.pr.merged",
  "linear.issue.read",
  "notion.page.read",
  "vercel.deploy",
  "user.prompt",
  "context.snapshot",
  "tool.work",
  "session.recap",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// --- Catalog ---

export type EventCategory = "lifecycle" | "work" | "interaction" | "integration" | "context";

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
  "session.started": { label: "started", category: "lifecycle", color: 34, detailColor: 245, skip: false },
  "session.resumed": { label: "resumed", category: "lifecycle", color: 34, detailColor: 245, skip: false },
  "session.end": { label: "ended", category: "lifecycle", color: 245, detailColor: 245, skip: false },
  "claude.started": { label: "claude started", category: "lifecycle", color: 35, detailColor: 245, skip: false },
  "claude.ended": { label: "claude ended", category: "lifecycle", color: 35, detailColor: 245, skip: false },
  "claude.discarded": { label: "discarded", category: "lifecycle", color: 245, detailColor: 245, skip: false },
  "session.waiting": { label: "waiting", category: "interaction", color: 33, detailColor: 245, skip: false },
  "session.answered": { label: "answered", category: "interaction", color: 36, detailColor: 245, skip: false },
  "permission.request": { label: "permission", category: "work", color: 214, detailColor: 245, skip: false },
  "permission.resolve": { label: "allowed", category: "work", color: 214, detailColor: 245, skip: false },
  "worktree.entered": { label: "worktree", category: "lifecycle", color: 35, detailColor: 245, skip: false },
  "worktree.exited": { label: "worktree exited", category: "lifecycle", color: 35, detailColor: 245, skip: false },
  "gh.pr.created": { label: "PR created", category: "integration", color: 32, detailColor: 32, skip: false },
  "gh.pr.merged": { label: "PR merged", category: "integration", color: 35, detailColor: 35, skip: false },
  "linear.issue.read": { label: "Linear issue", category: "integration", color: 33, detailColor: 33, skip: false },
  "notion.page.read": { label: "Notion page", category: "integration", color: 245, detailColor: 245, skip: false },
  "vercel.deploy": { label: "deployed", category: "integration", color: 245, detailColor: 245, skip: false },
  "user.prompt": { label: "prompt", category: "interaction", color: 36, detailColor: 245, skip: false },
  "context.snapshot": { label: "context", category: "context", color: 245, detailColor: 245, skip: true },
  "tool.work": { label: "tool work", category: "work", color: 214, detailColor: 245, skip: false },
  "session.recap": { label: "session recap", category: "lifecycle", color: 33, detailColor: 245, skip: false },
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
    case "permission.request":
    case "permission.resolve": {
      const tool = (meta.tool as string) ?? "";
      const detail = (meta.detail as string) ?? "";
      return detail ? `${tool}: ${detail}` : tool;
    }
    case "gh.pr.created": {
      const title = (meta.pr_title as string) ?? "";
      const url = (meta.pr_url as string) ?? "";
      return title || url;
    }
    case "gh.pr.merged":
      return (meta.branch as string) ?? "";
    case "worktree.entered":
      return (meta.branch as string) ?? "";
    case "linear.issue.read":
      return (meta.issue_title as string) ?? "";
    case "notion.page.read":
      return (meta.page_title as string) ?? "";
    case "vercel.deploy":
      return (meta.project_name as string) ?? "";
    case "user.prompt":
      return (meta.prompt as string) ?? "";
    case "context.snapshot":
      return (meta.remaining_pct as string) ? `${meta.remaining_pct}% remaining` : "";
    case "session.recap":
      return (meta.recap as string) ?? "";
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
