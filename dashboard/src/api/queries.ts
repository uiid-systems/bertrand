import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import { apiUrl } from "./base"
import type {
  SessionWithCategory,
  SessionRow,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  ArchiveErrorReason,
  WorkspaceServerStatus,
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
      return fetchJson<SessionWithCategory[]>(
        `/api/sessions${qs ? `?${qs}` : ""}`,
      )
    },
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  })

export const worktreesQuery = queryOptions({
  queryKey: ["worktrees"],
  queryFn: () => fetchJson<SessionWithCategory[]>("/api/worktrees"),
  refetchInterval: 2000,
  placeholderData: keepPreviousData,
})

/** Dev-server status per worktree-bearing session, keyed by session id. */
export const worktreeStatusQuery = queryOptions({
  queryKey: ["worktree-status"],
  queryFn: () =>
    fetchJson<Record<string, WorkspaceServerStatus>>("/api/worktrees/status"),
  refetchInterval: 2000,
  placeholderData: keepPreviousData,
})

async function postWorktreeAction(id: string, action: "start" | "stop"): Promise<void> {
  const res = await fetch(apiUrl(`/api/worktrees/${id}/${action}`), { method: "POST" })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  }
}

export const startWorktree = (id: string) => postWorktreeAction(id, "start")
export const stopWorktree = (id: string) => postWorktreeAction(id, "stop")

export async function fetchWorktreeLogs(id: string, lines = 200): Promise<string> {
  const res = await fetch(apiUrl(`/api/worktrees/${id}/logs?lines=${lines}`))
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const body = (await res.json()) as { logs: string }
  return body.logs
}

/** Single-project query string (`?project=slug`) for per-session endpoints. */
function projectParam(project: string | undefined): string {
  if (!project) return ""
  return `?${new URLSearchParams({ project }).toString()}`
}

export const eventsQuery = (sessionId: string, isLive = false, project?: string) =>
  queryOptions({
    queryKey: ["events", sessionId, project ?? null],
    queryFn: () =>
      fetchJson<EventRow[]>(`/api/events/${sessionId}${projectParam(project)}`),
    enabled: !!sessionId,
    refetchInterval: isLive ? 1000 : false,
    placeholderData: keepPreviousData,
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

export type ProjectSummary = {
  slug: string
  name: string
  active: boolean
  lastUsedAt: string
  /** Count of currently live (active/waiting) sessions in this project. */
  liveCount: number
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
