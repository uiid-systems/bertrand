export type EventCategory =
  | "interaction"
  | "work"
  | "lifecycle"
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
  "claude.started": { category: "lifecycle", color: "blue", label: "session started" },
  "claude.ended": { category: "lifecycle", color: "blue", label: "ended" },
  "claude.discarded": { category: "lifecycle", color: "neutral", label: "discarded" },
  "session.waiting": { category: "interaction", color: "green", label: "waiting" },
  "session.answered": { category: "interaction", color: "green", label: "Q&A" },
  "user.prompt": { category: "interaction", color: "green", label: "prompt" },
  "session.recap": { category: "lifecycle", color: "blue", label: "session recap" },
  "tool.work": { category: "work", color: "yellow", label: "tool work" },
  "tool.applied": { category: "work", color: "yellow", label: "applied" },
  "tool.used": { category: "work", color: "yellow", label: "tool" },
  "assistant.message": { category: "assistant", color: "indigo", label: "assistant" },
  "assistant.recap": { category: "assistant", color: "indigo", label: "thinking recap" },
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
