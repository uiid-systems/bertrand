import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { apiUrl } from "./base"
import type {
  SessionWithCategory,
  SessionRow,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  SessionRecap,
  ArchiveErrorReason,
} from "./types"

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path))
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export class ArchiveError extends Error {
  reason: ArchiveErrorReason
  constructor(message: string, reason: ArchiveErrorReason) {
    super(message)
    this.name = "ArchiveError"
    this.reason = reason
  }
}

async function postSessionAction(
  id: string,
  action: "archive" | "unarchive",
): Promise<SessionRow> {
  const res = await fetch(apiUrl(`/api/sessions/${id}/${action}`), {
    method: "POST",
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      reason?: ArchiveErrorReason
    }
    throw new ArchiveError(body.error ?? res.statusText, body.reason ?? "unknown")
  }
  return res.json()
}

export const archiveSession = (id: string) => postSessionAction(id, "archive")
export const unarchiveSession = (id: string) => postSessionAction(id, "unarchive")

export const sessionsQuery = (opts: { includeArchived?: boolean } = {}) =>
  queryOptions({
    queryKey: ["sessions", { includeArchived: !!opts.includeArchived }],
    queryFn: () =>
      fetchJson<SessionWithCategory[]>(
        opts.includeArchived
          ? "/api/sessions?excludeArchived=false"
          : "/api/sessions",
      ),
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

export const worktreesQuery = queryOptions({
  queryKey: ["worktrees"],
  queryFn: () => fetchJson<SessionWithCategory[]>("/api/worktrees"),
  refetchInterval: 2000,
  placeholderData: keepPreviousData,
})

export const eventsQuery = (sessionId: string, isLive = false) =>
  queryOptions({
    queryKey: ["events", sessionId],
    queryFn: () => fetchJson<EventRow[]>(`/api/events/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: isLive ? 1000 : false,
    placeholderData: keepPreviousData,
  })

export const statsQuery = (sessionId: string, isLive = false) =>
  queryOptions({
    queryKey: ["stats", sessionId],
    queryFn: () => fetchJson<SessionStatsRow | null>(`/api/stats/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: isLive ? 2000 : false,
    placeholderData: keepPreviousData,
  })

export const allStatsQuery = (hasLiveSession = false) =>
  queryOptions({
    queryKey: ["stats"],
    queryFn: () => fetchJson<Record<string, SessionStatsRow>>("/api/stats"),
    refetchInterval: hasLiveSession ? 2000 : false,
    placeholderData: keepPreviousData,
  })

export const engagementQuery = (sessionId: string, isLive = false) =>
  queryOptions({
    queryKey: ["engagement", sessionId],
    queryFn: () => fetchJson<EngagementStats>(`/api/engagement/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: isLive ? 2000 : false,
    placeholderData: keepPreviousData,
  })

export const recapsQuery = queryOptions({
  queryKey: ["recaps"],
  queryFn: () => fetchJson<Record<string, SessionRecap>>("/api/recaps"),
})

export type ProjectSummary = {
  slug: string
  name: string
  active: boolean
  lastUsedAt: string
}

export const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: () => fetchJson<ProjectSummary[]>("/api/projects"),
  refetchInterval: 5000,
})

export async function switchActiveProject(slug: string): Promise<void> {
  const res = await fetch(apiUrl("/api/active-project"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
}
