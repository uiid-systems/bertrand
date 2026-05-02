export type EventCategory =
  | "interaction"
  | "work"
  | "milestone"
  | "integration"
  | "lifecycle"
  | "context"
  | "assistant"

export type TimelineColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "indigo"
  | "purple"
  | "neutral"

type EventInfo = {
  category: EventCategory
  color: TimelineColor
  label: string
}

const EVENT_CATALOG: Record<string, EventInfo> = {
  "session.started": { category: "lifecycle", color: "blue", label: "session started" },
  "session.resumed": { category: "lifecycle", color: "blue", label: "session resumed" },
  "session.end": { category: "lifecycle", color: "neutral", label: "session ended" },
  "claude.started": { category: "lifecycle", color: "blue", label: "session started" },
  "claude.ended": { category: "lifecycle", color: "blue", label: "ended" },
  "claude.discarded": { category: "lifecycle", color: "neutral", label: "discarded" },
  "session.waiting": { category: "interaction", color: "green", label: "waiting" },
  "session.answered": { category: "interaction", color: "green", label: "Q&A" },
  "permission.request": { category: "work", color: "orange", label: "permission" },
  "permission.resolve": { category: "work", color: "orange", label: "approved" },
  "worktree.entered": { category: "lifecycle", color: "indigo", label: "worktree" },
  "worktree.exited": { category: "lifecycle", color: "indigo", label: "worktree exited" },
  "gh.pr.created": { category: "milestone", color: "purple", label: "pull request" },
  "gh.pr.merged": { category: "milestone", color: "purple", label: "merged" },
  "linear.issue.read": { category: "integration", color: "purple", label: "Linear" },
  "notion.page.read": { category: "integration", color: "purple", label: "Notion" },
  "vercel.deploy": { category: "milestone", color: "purple", label: "deploy" },
  "user.prompt": { category: "interaction", color: "green", label: "prompt" },
  "context.snapshot": { category: "context", color: "neutral", label: "context" },
  "tool.work": { category: "work", color: "yellow", label: "tool work" },
  "tool.applied": { category: "work", color: "yellow", label: "applied" },
  "assistant.message": { category: "assistant", color: "indigo", label: "assistant" },
}

const DEFAULT_INFO: EventInfo = {
  category: "lifecycle",
  color: "neutral",
  label: "unknown",
}

function lookup(event: string): EventInfo {
  return EVENT_CATALOG[event] ?? DEFAULT_INFO
}

export function categoryOf(event: string): EventCategory {
  return lookup(event).category
}

export function colorOf(event: string): TimelineColor {
  return lookup(event).color
}

export function labelOf(event: string): string {
  return lookup(event).label
}
