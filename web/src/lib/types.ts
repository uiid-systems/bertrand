export type SessionStatus = "working" | "blocked" | "prompting" | "paused" | "archived"

export interface Session {
  session: string
  status: SessionStatus
  summary: string
  pid: number
  timestamp: string
}

export interface TypedEvent {
  V: number
  Event: string
  Session: string
  TS: string
  TypedMeta: Record<string, string> | null
}
