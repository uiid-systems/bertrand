export type EventCategory = "interaction" | "work" | "lifecycle" | "assistant";

export type TimelineColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "indigo"
  | "purple"
  | "neutral";

type EventInfo = {
  category: EventCategory;
  color: TimelineColor;
  label: string;
};

export const EVENT_CATALOG = {
  "claude.started": {
    category: "lifecycle",
    color: "orange",
    label: "Session started",
  },
  "claude.ended": {
    category: "lifecycle",
    color: "orange",
    label: "Session ended",
  },
  "claude.discarded": {
    category: "lifecycle",
    color: "neutral",
    label: "discarded",
  },
  "session.waiting": {
    category: "interaction",
    color: "green",
    label: "waiting",
  },
  "session.answered": { category: "interaction", color: "green", label: "Q&A" },
  "user.prompt": {
    category: "interaction",
    color: "blue",
    label: "User prompted",
  },
  "tool.work": { category: "work", color: "yellow", label: "tool work" },
  "tool.applied": { category: "work", color: "yellow", label: "applied" },
  "tool.used": { category: "work", color: "yellow", label: "tool" },
  "assistant.message": {
    category: "assistant",
    color: "indigo",
    label: "Agent's response",
  },
  "agent.turn": {
    category: "assistant",
    color: "indigo",
    label: "Agent's response",
  },
} as const satisfies Record<string, EventInfo>;

/** Every event kind with catalog metadata. Icons live in `./icons`, keyed by this union. */
export type KnownEvent = keyof typeof EVENT_CATALOG;

const DEFAULT_INFO: EventInfo = {
  category: "lifecycle",
  color: "neutral",
  label: "unknown",
};

function lookup(event: string): EventInfo {
  return EVENT_CATALOG[event as KnownEvent] ?? DEFAULT_INFO;
}

export function categoryOf(event: string): EventCategory {
  return lookup(event).category;
}

export function colorOf(event: string): TimelineColor {
  return lookup(event).color;
}

export function labelOf(event: string): string {
  return lookup(event).label;
}
