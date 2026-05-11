import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import type {
  SessionWithGroup,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  SessionRecap,
} from "./types"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: () => fetchJson<SessionWithGroup[]>("/api/sessions"),
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
