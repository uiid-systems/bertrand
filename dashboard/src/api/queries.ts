import { queryOptions } from "@tanstack/react-query"
import type { SessionWithGroup, EventRow, SessionStatsRow } from "./types"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

export const sessionsQuery = queryOptions({
  queryKey: ["sessions"],
  queryFn: () => fetchJson<SessionWithGroup[]>("/api/sessions"),
})

export const eventsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["events", sessionId],
    queryFn: () => fetchJson<EventRow[]>(`/api/events/${sessionId}`),
    enabled: !!sessionId,
  })

export const statsQuery = (sessionId: string) =>
  queryOptions({
    queryKey: ["stats", sessionId],
    queryFn: () => fetchJson<SessionStatsRow | null>(`/api/stats/${sessionId}`),
    enabled: !!sessionId,
  })
