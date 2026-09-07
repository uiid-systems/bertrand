import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { apiUrl } from "./base"
import type {
  SessionListRow,
  SessionRow,
  EventRow,
  ArchiveErrorReason,
  SessionActionErrorReason,
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
export const unarchiveSession = (id: string) =>
  postSessionAction(id, "unarchive")

/** Thrown by the end-of-session actions (#214) that aren't archive. */
export class SessionActionError extends Error {
  reason: SessionActionErrorReason
  constructor(message: string, reason: SessionActionErrorReason) {
    super(message)
    this.name = "SessionActionError"
    this.reason = reason
  }
}

async function postSessionActionJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(apiUrl(path), { method: "POST", ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      reason?: SessionActionErrorReason
    }
    throw new SessionActionError(
      body.error ?? res.statusText,
      body.reason ?? "unknown",
    )
  }
  return res.json()
}

export type ResumeSessionResult = {
  sessionId: string
  claudeId: string
  pid: number
}

/**
 * Resume a session under the server's ownership. Omitting `conversationId`
 * starts a new conversation under the same session.
 */
export const resumeSession = (
  id: string,
  conversationId?: string,
): Promise<ResumeSessionResult> =>
  postSessionActionJson<ResumeSessionResult>(`/api/sessions/${id}/resume`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conversationId ? { conversationId } : {}),
  })

/**
 * Every session the server knows about.
 *
 * There is no scope parameter any more. The server reads one DB, and each row
 * carries the columns a client groups by (`repo`, `branch`, `groupKey`) — so
 * narrowing is a client-side slice of one cached response rather than a
 * differently-keyed fetch, which is what the `?projects=` filter used to force.
 */
export const sessionsQuery = (opts: { includeArchived?: boolean } = {}) =>
  queryOptions({
    queryKey: ["sessions", { includeArchived: !!opts.includeArchived }],
    queryFn: () =>
      fetchJson<SessionListRow[]>(
        `/api/sessions${opts.includeArchived ? "?excludeArchived=false" : ""}`,
      ),
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

/**
 * Server ordering is (createdAt, id) — transcript ingestion can backdate a
 * new row's createdAt, so incremental rows can't just be appended; the merged
 * list must be re-sorted to match what a full fetch would return.
 */
function byTimelineOrder(a: EventRow, b: EventRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id - b.id
}

export const eventsQuery = (sessionId: string, isLive = false) =>
  queryOptions({
    queryKey: ["events", sessionId],
    // Incremental poll: events are append-only, so after the first full fetch
    // each tick asks only for rows past the max id already in the cache.
    // While the session is idle this returns an empty array and we hand back
    // the previous reference untouched — no re-parse, no structural-share
    // walk, no re-render.
    queryFn: async ({ client, queryKey }) => {
      const prev = client.getQueryData<EventRow[]>(queryKey)
      const params = new URLSearchParams()
      if (prev && prev.length > 0) {
        const sinceId = prev.reduce((max, e) => Math.max(max, e.id), 0)
        params.set("sinceId", String(sinceId))
      }
      const qs = params.toString()
      const fresh = await fetchJson<EventRow[]>(
        `/api/events/${sessionId}${qs ? `?${qs}` : ""}`,
      )
      if (!prev || prev.length === 0) return fresh
      if (fresh.length === 0) return prev
      // Drop ids we already hold — guards against a server that ignores
      // sinceId (version skew between a hosted SPA and an older local server)
      // returning the full list again.
      const seen = new Set(prev.map((e) => e.id))
      const added = fresh.filter((e) => !seen.has(e.id))
      if (added.length === 0) return prev
      return [...prev, ...added].sort(byTimelineOrder)
    },
    enabled: !!sessionId,
    refetchInterval: isLive ? 1000 : false,
    placeholderData: keepPreviousData,
    // The queryFn already reuses the previous array when nothing changed;
    // skipping the default deep-compare avoids walking every meta blob on
    // every appended tick.
    structuralSharing: false,
  })

