import { execFile } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { getAllSessions, getSession } from "@/db/queries/sessions"
import { getEventsBySession, getEventsByType } from "@/db/queries/events"
import { getSessionStats } from "@/db/queries/stats"
import { computeSessionStats } from "@/lib/timing"
import { computeEngagementStats } from "@/lib/engagement_stats"
import {
  archiveSession,
  unarchiveSession,
  type ArchiveResult,
  type UnarchiveResult,
} from "@/lib/session-archive"
import {
  listProjects,
  setActiveProjectSlug,
  projectExists,
} from "@/lib/projects/registry"
import {
  resolveActiveProject,
  _resetActiveProjectCache,
} from "@/lib/projects/resolve"
import { invalidateDbCache } from "@/db/client"
import type {
  SessionRow,
  SessionWithCategory,
  EventRow,
  SessionStatsRow,
  EngagementStats,
} from "@/types"

const PORT = Number(process.env.BERTRAND_PORT ?? 5200)

type RouteHandler = (params: Record<string, string | undefined>, url: URL) => unknown

function liveStats(sessionId: string): SessionStatsRow {
  return {
    sessionId,
    ...computeSessionStats(sessionId),
    updatedAt: new Date().toISOString(),
  }
}

const listSessions = (_params: object, url: URL): SessionWithCategory[] => {
  const excludeArchived = url.searchParams.get("excludeArchived") !== "false"
  return getAllSessions({ excludeArchived })
}

const getSessionById = ({ id }: { id?: string }): SessionRow | undefined =>
  getSession(id!)

const listEvents = (
  { sessionId }: { sessionId?: string },
  url: URL,
): EventRow[] => {
  const eventType = url.searchParams.get("type")
  if (eventType) return getEventsByType(sessionId!, eventType)
  return getEventsBySession(sessionId!)
}

const listAllStats = (): Record<string, SessionStatsRow> => {
  const result: Record<string, SessionStatsRow> = {}
  for (const { session } of getAllSessions()) {
    const isLive = session.status === "active" || session.status === "waiting"
    if (isLive) {
      result[session.id] = liveStats(session.id)
      continue
    }
    result[session.id] = getSessionStats(session.id) ?? liveStats(session.id)
  }
  return result
}

const getStatsBySession = ({
  sessionId,
}: {
  sessionId?: string
}): SessionStatsRow | null => {
  const session = getSession(sessionId!)
  if (!session) return null
  const isLive = session.status === "active" || session.status === "waiting"
  if (isLive) return liveStats(sessionId!)
  return getSessionStats(sessionId!) ?? liveStats(sessionId!)
}

const getEngagement = ({
  sessionId,
}: {
  sessionId?: string
}): EngagementStats => computeEngagementStats(sessionId!)

const listAllProjects = (): unknown => {
  const active = resolveActiveProject()
  return listProjects().map((p) => ({
    slug: p.slug,
    name: p.name,
    active: p.slug === active.slug,
    lastUsedAt: p.lastUsedAt,
  }))
}

const getActiveProjectMeta = (): unknown => {
  const active = resolveActiveProject()
  return { slug: active.slug, name: active.name }
}

// Sessions currently working in a worktree. Derived from the worktree_path
// column the EnterWorktree hook maintains — no git shell-out, so this stays a
// synchronous handler like the rest. Phase 1 can enrich each row with live git
// state (liveness, diff stats) once dev-server management lands.
const listWorktreeSessions = (): SessionWithCategory[] =>
  getAllSessions({ excludeArchived: true }).filter(
    ({ session }) => session.worktreePath != null,
  )

const routes: [RegExp, RouteHandler][] = [
  [/^\/api\/sessions$/, listSessions],
  [/^\/api\/sessions\/(?<id>[^/]+)$/, getSessionById],
  [/^\/api\/worktrees$/, listWorktreeSessions],
  [/^\/api\/events\/(?<sessionId>[^/]+)$/, listEvents],
  [/^\/api\/stats$/, listAllStats],
  [/^\/api\/stats\/(?<sessionId>[^/]+)$/, getStatsBySession],
  [/^\/api\/engagement\/(?<sessionId>[^/]+)$/, getEngagement],
  [/^\/api\/projects$/, listAllProjects],
  [/^\/api\/active-project$/, getActiveProjectMeta],
]

const ARCHIVE_ERROR: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Session not found" },
  active: { status: 409, message: "Cannot archive an active session" },
  "already-archived": { status: 409, message: "Session is already archived" },
  "not-archived": { status: 409, message: "Session is not archived" },
}

function archiveResponse(result: ArchiveResult | UnarchiveResult): Response {
  if (result.ok) return Response.json(result.session)
  const meta = ARCHIVE_ERROR[result.reason] ?? { status: 400, message: "Operation failed" }
  return Response.json({ error: meta.message, reason: result.reason }, { status: meta.status })
}

/**
 * Switch the active project. Writes the new slug to the registry, then drops
 * the in-process caches that pin the previous project: the memoized active-
 * project resolver and the per-DB-path drizzle handle map. The next request
 * resolves the new active project and re-opens its DB lazily — no restart,
 * no respawn window for the client to bridge over.
 *
 * Safe under concurrent requests because `invalidateDbCache` only drops the
 * cache entries; existing handles held by in-flight queries continue to work
 * and free themselves on GC.
 */
async function handleSwitchProject(req: Request): Promise<Response> {
  let body: { slug?: unknown }
  try {
    body = (await req.json()) as { slug?: unknown }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const slug = body.slug
  if (typeof slug !== "string") {
    return Response.json({ error: "slug must be a string" }, { status: 400 })
  }
  if (!projectExists(slug)) {
    return Response.json({ error: `Unknown project: ${slug}` }, { status: 404 })
  }
  setActiveProjectSlug(slug)
  // resolveActiveProject() honors BERTRAND_PROJECT over the registry — the
  // spawn-time pin that keeps hook subprocesses anchored to their parent
  // session. The dashboard server is long-lived and the click is an
  // explicit override, so we update this process's env to match before
  // dropping the caches that read it.
  process.env.BERTRAND_PROJECT = slug
  _resetActiveProjectCache()
  invalidateDbCache()
  return Response.json({ ok: true, slug })
}

async function handleOpen(req: Request): Promise<Response> {
  let body: { path?: unknown }
  try {
    body = (await req.json()) as { path?: unknown }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const path = body.path
  if (typeof path !== "string" || !path.startsWith("/")) {
    return Response.json({ error: "path must be an absolute string" }, { status: 400 })
  }

  return new Promise<Response>((resolve) => {
    execFile("open", [path], (err) => {
      if (err) {
        resolve(Response.json({ error: err.message }, { status: 500 }))
        return
      }
      resolve(Response.json({ ok: true }))
    })
  })
}

function match(pathname: string, url: URL): Response {
  for (const [pattern, handler] of routes) {
    const m = pattern.exec(pathname)
    if (!m) continue
    try {
      const result = handler(m.groups ?? {}, url)
      return Response.json(result ?? null)
    } catch (err) {
      console.error(`[server] ${pathname} failed:`, err)
      const message = err instanceof Error ? err.message : "Internal server error"
      return Response.json({ error: message }, { status: 500 })
    }
  }
  return Response.json({ error: "Not found" }, { status: 404 })
}

// Locate a bundled dashboard relative to this file. Present in the
// published package (build.ts copies dashboard/dist → dist/dashboard),
// where this file lives at dist/bertrand.js so dashboard/ is a sibling.
// Absent in dev runs (`bun run src/index.ts serve`), where the user is
// expected to run vite separately.
function findDashboardDir(): string | null {
  const candidates = [
    join(import.meta.dir, "dashboard"),         // built: dist/bertrand.js → dist/dashboard
    join(import.meta.dir, "..", "dashboard"),   // unlikely, but cheap to check
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir
  }
  return null
}

const DASHBOARD_DIR = findDashboardDir()

async function serveDashboard(pathname: string): Promise<Response | null> {
  if (!DASHBOARD_DIR) return null
  const requested = pathname === "/" ? "/index.html" : pathname
  const filePath = join(DASHBOARD_DIR, requested)
  if (!filePath.startsWith(DASHBOARD_DIR)) return null  // traversal guard
  const file = Bun.file(filePath)
  if (await file.exists()) return new Response(file)
  // SPA fallback — unknown paths render index.html so client routing works.
  return new Response(Bun.file(join(DASHBOARD_DIR, "index.html")))
}

export function startServer(port = PORT) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)

      // CORS for dev
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        })
      }

      // Hand off to the platform `open` binary. macOS-only for now; runs
      // server-side so the browser doesn't need to expose file:// access.
      if (req.method === "POST" && url.pathname === "/api/open") {
        const r = await handleOpen(req)
        r.headers.set("Access-Control-Allow-Origin", "*")
        return r
      }

      // Switch the active project in-process (see handler).
      if (req.method === "POST" && url.pathname === "/api/active-project") {
        const r = await handleSwitchProject(req)
        r.headers.set("Access-Control-Allow-Origin", "*")
        return r
      }

      if (req.method === "POST") {
        const archiveMatch = /^\/api\/sessions\/([^/]+)\/archive$/.exec(url.pathname)
        if (archiveMatch) {
          const response = archiveResponse(archiveSession(archiveMatch[1]!))
          response.headers.set("Access-Control-Allow-Origin", "*")
          return response
        }
        const unarchiveMatch = /^\/api\/sessions\/([^/]+)\/unarchive$/.exec(url.pathname)
        if (unarchiveMatch) {
          const response = archiveResponse(unarchiveSession(unarchiveMatch[1]!))
          response.headers.set("Access-Control-Allow-Origin", "*")
          return response
        }
      }

      if (url.pathname.startsWith("/api/")) {
        const response = match(url.pathname, url)
        response.headers.set("Access-Control-Allow-Origin", "*")
        return response
      }

      const dashboardResponse = await serveDashboard(url.pathname)
      if (dashboardResponse) return dashboardResponse

      const response = match(url.pathname, url)
      response.headers.set("Access-Control-Allow-Origin", "*")
      return response
    },
  })

  const dashboardNote = DASHBOARD_DIR ? " (with bundled dashboard)" : ""
  console.log(
    `bertrand API server listening on http://localhost:${server.port}${dashboardNote}`,
  )
  return server
}
