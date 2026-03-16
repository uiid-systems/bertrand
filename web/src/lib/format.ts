export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + "s"
  const m = Math.floor(s / 60)
  if (m < 60) return m + "m"
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? h + "h" + rm + "m" : h + "h"
}

export function formatAgo(ts: string): string {
  const d = Date.now() - new Date(ts).getTime()
  if (d < 60000) return "just now"
  if (d < 3600000) return Math.floor(d / 60000) + "m ago"
  if (d < 86400000) return Math.floor(d / 3600000) + "h ago"
  return Math.floor(d / 86400000) + "d ago"
}

const EVENT_LABELS: Record<string, string> = {
  "session.started": "started",
  "session.resumed": "resumed",
  "session.resume": "resumed",
  "session.block": "blocked",
  "session.end": "ended",
  "claude.started": "claude start",
  "claude.ended": "claude end",
  "claude.discarded": "discarded",
  "permission.request": "permission",
  "permission.resolve": "approved",
  "worktree.entered": "worktree",
  "worktree.exited": "worktree exit",
  "gh.pr.created": "PR created",
  "gh.pr.merged": "PR merged",
  "linear.issue.read": "linear",
  "context.snapshot": "context",
}

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event
}

export type EventColorClass =
  | "started"
  | "resumed"
  | "blocked"
  | "ended"
  | "permission"
  | "pr"
  | "linear"
  | ""

export function eventClass(event: string): EventColorClass {
  if (event.includes("start") || event === "session.resume") return "started"
  if (event === "session.resumed") return "resumed"
  if (event.includes("block")) return "blocked"
  if (event.includes("end") || event.includes("done")) return "ended"
  if (event.includes("permission")) return "permission"
  if (event.includes("pr.") || event.includes("worktree")) return "pr"
  if (event.includes("linear")) return "linear"
  return ""
}

export function metaSummary(meta: Record<string, string> | null): string {
  if (!meta) return ""
  if (meta["question"]) return meta["question"]
  if (meta["summary"]) return meta["summary"]
  if (meta["tool"]) return meta["tool"]
  if (meta["branch"]) return meta["branch"]
  if (meta["url"]) return meta["url"]
  if (meta["claude_id"]) return meta["claude_id"].substring(0, 8)
  return ""
}
