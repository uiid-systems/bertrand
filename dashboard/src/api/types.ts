export type SessionRow = {
  id: string
  groupId: string
  slug: string
  name: string
  status: "active" | "waiting" | "paused" | "archived"
  summary: string | null
  pid: number | null
  startedAt: string
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SessionWithGroup = {
  session: SessionRow
  groupPath: string
}

export type EventRow = {
  id: number
  sessionId: string
  conversationId: string | null
  event: string
  summary: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

export type SessionStatsRow = {
  sessionId: string
  eventCount: number
  conversationCount: number
  interactionCount: number
  prCount: number
  claudeWorkS: number
  userWaitS: number
  activePct: number
  durationS: number
  linesAdded: number
  linesRemoved: number
  filesTouched: number
  updatedAt: string
}
