import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { apiUrl } from "./base"
import type {
  SessionListRow,
  SessionRow,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  ArchiveErrorReason,
  SessionActionErrorReason,
  ProjectSummary,
  SessionPullRequest,
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
  project?: string,
): Promise<SessionRow> {
  const res = await fetch(
    apiUrl(`/api/sessions/${id}/${action}${projectParam(project)}`),
    { method: "POST" },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      reason?: ArchiveErrorReason
    }
    throw new ArchiveError(body.error ?? res.statusText, body.reason ?? "unknown")
  }
  return res.json()
}

export const archiveSession = (id: string, project?: string) =>
  postSessionAction(id, "archive", project)
export const unarchiveSession = (id: string, project?: string) =>
  postSessionAction(id, "unarchive", project)

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

/** Permanently delete the session and everything cascading from it. */
export const discardSession = (id: string, project?: string): Promise<{ ok: true }> =>
  postSessionActionJson<{ ok: true }>(
    `/api/sessions/${id}/discard${projectParam(project)}`,
  )

export type ResumeSessionResult = {
  sessionId: string
  claudeId: string
  pid: number
}

/**
 * Resume a session under the server's ownership. Omitting `conversationId`
 * starts a new conversation under the same session.
 *
 * Not project-scoped: resuming spawns a process the server has to own, and the
 * server only ever spawns into its own active project.
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
 * Serialize a projects filter into a query string. `undefined` omits the param
 * entirely (server falls back to the active project); an array — including an
 * empty one — always sets `projects=`, so an empty selection returns nothing
 * rather than silently reverting to the active project.
 */
function projectsParam(projects: string[] | undefined): string {
  if (projects === undefined) return ""
  const qs = new URLSearchParams({ projects: projects.join(",") }).toString()
  return `?${qs}`
}

export const sessionsQuery = (
  opts: { includeArchived?: boolean; projects?: string[] } = {},
) =>
  queryOptions({
    queryKey: [
      "sessions",
      { includeArchived: !!opts.includeArchived, projects: opts.projects ?? null },
    ],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts.includeArchived) params.set("excludeArchived", "false")
      if (opts.projects !== undefined) params.set("projects", opts.projects.join(","))
      const qs = params.toString()
      return fetchJson<SessionListRow[]>(
        `/api/sessions${qs ? `?${qs}` : ""}`,
      )
    },
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

/** Single-project query string (`?project=slug`) for per-session endpoints. */
function projectParam(project: string | undefined): string {
  if (!project) return ""
  return `?${new URLSearchParams({ project }).toString()}`
}

/**
 * Server ordering is (createdAt, id) — transcript ingestion can backdate a
 * new row's createdAt, so incremental rows can't just be appended; the merged
 * list must be re-sorted to match what a full fetch would return.
 */
function byTimelineOrder(a: EventRow, b: EventRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id - b.id
}

export const eventsQuery = (sessionId: string, isLive = false, project?: string) =>
  queryOptions({
    queryKey: ["events", sessionId, project ?? null],
    // Incremental poll: events are append-only, so after the first full fetch
    // each tick asks only for rows past the max id already in the cache.
    // While the session is idle this returns an empty array and we hand back
    // the previous reference untouched — no re-parse, no structural-share
    // walk, no re-render.
    queryFn: async ({ client, queryKey }) => {
      const prev = client.getQueryData<EventRow[]>(queryKey)
      const params = new URLSearchParams()
      if (project) params.set("project", project)
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

export const statsQuery = (sessionId: string, isLive = false, project?: string) =>
  queryOptions({
    queryKey: ["stats", sessionId, project ?? null],
    queryFn: () =>
      fetchJson<SessionStatsRow | null>(
        `/api/stats/${sessionId}${projectParam(project)}`,
      ),
    enabled: !!sessionId,
    refetchInterval: isLive ? 2000 : false,
    placeholderData: keepPreviousData,
  })

/**
 * The pull request for a session's branch, with its check rollup.
 *
 * Polled on a fixed interval rather than gated on `isLive`, because checks
 * move on GitHub's clock, not the session's: the branch a paused session left
 * behind is exactly the one whose CI someone is waiting on. 30s matches the
 * server's per-branch TTL, so a faster poll would only re-serve the same
 * cached answer, and a slower one would leave a green build looking pending.
 */
export const pullRequestQuery = (sessionId: string, project?: string) =>
  queryOptions({
    queryKey: ["pull-request", sessionId, project ?? null],
    queryFn: () =>
      fetchJson<SessionPullRequest>(
        `/api/github/${sessionId}/pr${projectParam(project)}`,
      ),
    enabled: !!sessionId,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  })

export const allStatsQuery = (
  opts: { hasLiveSession?: boolean; projects?: string[] } = {},
) =>
  queryOptions({
    queryKey: ["stats", { projects: opts.projects ?? null }],
    queryFn: () =>
      fetchJson<Record<string, SessionStatsRow>>(
        `/api/stats${projectsParam(opts.projects)}`,
      ),
    refetchInterval: opts.hasLiveSession ? 2000 : false,
    placeholderData: keepPreviousData,
  })

export const engagementQuery = (
  sessionId: string,
  isLive = false,
  project?: string,
) =>
  queryOptions({
    queryKey: ["engagement", sessionId, project ?? null],
    queryFn: () =>
      fetchJson<EngagementStats>(
        `/api/engagement/${sessionId}${projectParam(project)}`,
      ),
    enabled: !!sessionId,
    refetchInterval: isLive ? 2000 : false,
    placeholderData: keepPreviousData,
  })

// Re-exported rather than re-declared: the shape is the server's, and a local
// copy would drift silently the next time a field is added to the response.
export type { ProjectSummary }

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
