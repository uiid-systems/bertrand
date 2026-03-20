export type SessionStatus = "working" | "blocked" | "prompting" | "paused" | "archived"

export interface Session {
  session: string
  status: SessionStatus
  summary: string
  pid: number
  timestamp: string
}

export interface EnrichedEvent {
  event: string
  session: string
  ts: string
  summary: string
  label: string
  category: string
  color: string
  meta: Record<string, string> | null
}

export interface SessionDigest {
  session: string
  started_at: string
  ended_at: string
  duration_s: number
  event_count: number
  interactions: number
  conversations: number
  prs: number
  timeline: EnrichedEvent[]
  events: EnrichedEvent[]
}
