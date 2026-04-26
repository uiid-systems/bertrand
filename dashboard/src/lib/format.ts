import type { EventRow, SessionRow } from "../api/types"

type SessionStatus = SessionRow["status"]

const PALETTE_BY_STATUS = {
  active: "green",
  waiting: "yellow",
  paused: "neutral",
  archived: "neutral",
} as const

export function statusColor(status: SessionStatus) {
  return PALETTE_BY_STATUS[status]
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "0s"

  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000

  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`

  return new Date(iso).toLocaleDateString()
}

type TimelineColor = "red" | "orange" | "yellow" | "green" | "blue" | "indigo" | "purple" | "neutral"

const EVENT_CATEGORY: Record<string, TimelineColor> = {
  "session.started": "blue",
  "session.resumed": "blue",
  "session.end": "neutral",
  "claude.started": "blue",
  "claude.ended": "blue",
  "claude.discarded": "neutral",
  "session.waiting": "green",
  "session.answered": "green",
  "permission.request": "orange",
  "permission.resolve": "orange",
  "worktree.entered": "indigo",
  "worktree.exited": "indigo",
  "gh.pr.created": "purple",
  "gh.pr.merged": "purple",
  "linear.issue.read": "purple",
  "notion.page.read": "purple",
  "vercel.deploy": "purple",
  "user.prompt": "green",
  "context.snapshot": "neutral",
  "tool.work": "yellow",
}

const EVENT_LABEL: Record<string, string> = {
  "session.started": "started",
  "session.resumed": "resumed",
  "session.end": "ended",
  "claude.started": "claude started",
  "claude.ended": "claude ended",
  "claude.discarded": "discarded",
  "session.waiting": "waiting",
  "session.answered": "answered",
  "permission.request": "permission",
  "permission.resolve": "allowed",
  "worktree.entered": "worktree",
  "worktree.exited": "worktree exited",
  "gh.pr.created": "PR created",
  "gh.pr.merged": "PR merged",
  "linear.issue.read": "Linear issue",
  "notion.page.read": "Notion page",
  "vercel.deploy": "deployed",
  "user.prompt": "prompt",
  "context.snapshot": "context",
  "tool.work": "tool work",
}

export function eventColor(event: string): TimelineColor {
  return EVENT_CATEGORY[event] ?? "neutral"
}

export function eventLabel(event: string): string {
  return EVENT_LABEL[event] ?? event
}

export function eventTitle(event: EventRow): string {
  const label = eventLabel(event.event)
  const meta = event.meta as Record<string, unknown> | null

  if (!meta) return label

  switch (event.event) {
    case "session.answered": {
      const question = meta.question as string | undefined
      return question ?? label
    }
    case "permission.request":
    case "permission.resolve": {
      const tool = meta.tool as string | undefined
      return tool ? `${label}: ${tool}` : label
    }
    case "gh.pr.created":
      return meta.pr_title ? `${label}: ${meta.pr_title}` : label
    case "gh.pr.merged":
      return meta.branch ? `${label}: ${meta.branch}` : label
    case "worktree.entered":
      return meta.branch ? `${label}: ${meta.branch}` : label
    case "linear.issue.read":
      return meta.issue_title ? `${label}: ${meta.issue_title}` : label
    case "notion.page.read":
      return meta.page_title ? `${label}: ${meta.page_title}` : label
    case "vercel.deploy":
      return meta.project_name ? `${label}: ${meta.project_name}` : label
    default:
      return label
  }
}

export function eventDescription(event: EventRow): string | undefined {
  if (event.summary) return event.summary

  const meta = event.meta as Record<string, unknown> | null
  if (!meta) return undefined

  switch (event.event) {
    case "session.waiting":
      return meta.question as string | undefined
    case "session.answered":
      return meta.answer as string | undefined
    case "user.prompt":
      return meta.prompt as string | undefined
    case "permission.request":
    case "permission.resolve":
      return meta.detail as string | undefined
    case "context.snapshot":
      return meta.remaining_pct ? `${meta.remaining_pct}% context remaining` : undefined
    case "gh.pr.created":
      return meta.pr_url as string | undefined
    default:
      return undefined
  }
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}
