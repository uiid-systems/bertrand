import type { Icon } from "@uiid/icons"
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleXIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlayIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
} from "@uiid/icons"

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
  icon: Icon
}

const EVENT_CATALOG: Record<string, EventInfo> = {
  "claude.started": { category: "lifecycle", color: "blue", label: "session started", icon: PlayIcon },
  "claude.ended": { category: "lifecycle", color: "blue", label: "ended", icon: CircleCheckIcon },
  "claude.discarded": { category: "lifecycle", color: "neutral", label: "discarded", icon: CircleXIcon },
  "session.waiting": { category: "interaction", color: "green", label: "waiting", icon: CircleHelpIcon },
  "session.answered": { category: "interaction", color: "green", label: "Q&A", icon: MessagesSquareIcon },
  "user.prompt": { category: "interaction", color: "green", label: "prompt", icon: MessageSquareIcon },
  "tool.work": { category: "work", color: "yellow", label: "tool work", icon: WrenchIcon },
  "tool.applied": { category: "work", color: "yellow", label: "applied", icon: PencilIcon },
  "tool.used": { category: "work", color: "yellow", label: "tool", icon: TerminalIcon },
  "assistant.message": { category: "assistant", color: "indigo", label: "assistant", icon: SparklesIcon },
}

const DEFAULT_INFO: EventInfo = {
  category: "lifecycle",
  color: "neutral",
  label: "unknown",
  icon: CircleDotIcon,
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

export function iconOf(event: string): Icon {
  return lookup(event).icon
}
