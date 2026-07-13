import { execFile } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { getMainWorktree, getWorktreeBranch } from "@/lib/git"
import {
  startWorkspaceServer,
  stopWorkspaceServer,
  getWorkspaceServer,
  readWorkspaceLog,
  reapOrphanWorkspaces,
  type WorkspaceServerStatus,
} from "@/lib/workspace"
import {
  getAllSessionsForProject,
  getSession,
  countLiveSessions,
} from "@/db/queries/sessions"
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
import { removeSessionWorktree } from "@/lib/worktree-remove"
import {
  listProjects,
  setActiveProjectSlug,
  projectExists,
} from "@/lib/projects/registry"
import {
  resolveActiveProject,
  _resetActiveProjectCache,
} from "@/lib/projects/resolve"
import { getDbForProject, invalidateDbCache, type Db } from "@/db/client"
import type {
  SessionRow,
  SessionWithCategory,
  WorktreeSessionRow,
  EventRow,
  SessionStatsRow,
  EngagementStats,
} from "@/types"

const PORT = Number(process.env.BERTRAND_PORT ?? 5200)

type RouteHandler = (params: Record<string, string | undefined>, url: URL) => unknown

function liveStats(sessionId: string, db?: Db): SessionStatsRow {
  return {
    sessionId,
    ...computeSessionStats(sessionId, db),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Which projects a list/stats request covers. `?projects=a,b,c` names them
 * explicitly (unknown slugs dropped, empty string → no projects); omitting the
 * param falls back to the active project alone, preserving the single-project
 * behavior for any consumer that doesn't opt into the multi-project view.
 */
function resolveProjectScope(url: URL): { slug: string; name: string }[] {
  const nameBySlug = new Map(listProjects().map((p) => [p.slug, p.name]))
  const param = url.searchParams.get("projects")
  if (param === null) {
    const active = resolveActiveProject()
    return [{ slug: active.slug, name: active.name }]
  }
  return param
    .split(",")
    .map((s) => s.trim())
    .filter((slug) => nameBySlug.has(slug))
    .map((slug) => ({ slug, name: nameBySlug.get(slug)! }))
}

/**
 * DB handle for a single-session request (`events`, `stats/:id`, `engagement`).
 * `?project=slug` targets that project's DB; absent or unknown falls through to
 * `undefined` so the callee's `getDb()` default (the active project) applies.
 */
function resolveDb(url: URL): Db | undefined {
  const slug = url.searchParams.get("project")
  if (slug && projectExists(slug)) return getDbForProject(slug)
  return undefined
}

const listSessions = (_params: object, url: URL): SessionWithCategory[] => {
  const excludeArchived = url.searchParams.get("excludeArchived") !== "false"
  return resolveProjectScope(url).flatMap((project) =>
    getAllSessionsForProject(project, { excludeArchived }),
  )
}

const getSessionById = ({ id }: { id?: string }): SessionRow | undefined =>
  getSession(id!)

const listEvents = (
  { sessionId }: { sessionId?: string },
  url: URL,
): EventRow[] => {
  const db = resolveDb(url)
  const eventType = url.searchParams.get("type")
  if (eventType) return getEventsByType(sessionId!, eventType, db)
  // `?sinceId=N` returns only rows with id > N — the dashboard's live poll
  // passes the max id it has seen so idle ticks cost ~0 bytes instead of the
  // full timeline. Invalid/absent values fall back to the full list.
  const sinceParam = Number(url.searchParams.get("sinceId"))
  const sinceId = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : undefined
  return getEventsBySession(sessionId!, db, { sinceId })
}

const listAllStats = (
  _params: object,
  url: URL,
): Record<string, SessionStatsRow> => {
  const result: Record<string, SessionStatsRow> = {}
  for (const project of resolveProjectScope(url)) {
    const db = getDbForProject(project.slug)
    for (const { session } of getAllSessionsForProject(project)) {
      const isLive =
        session.status === "active" ||
        session.status === "waiting" ||
        session.status === "blocked"
      if (isLive) {
        result[session.id] = liveStats(session.id, db)
        continue
      }
      result[session.id] =
        getSessionStats(session.id, db) ?? liveStats(session.id, db)
    }
  }
  return result
}

const getStatsBySession = (
  { sessionId }: { sessionId?: string },
  url: URL,
): SessionStatsRow | null => {
  const db = resolveDb(url)
  const session = getSession(sessionId!, db)
  if (!session) return null
  const isLive = session.status === "active" ||
        session.status === "waiting" ||
        session.status === "blocked"
  if (isLive) return liveStats(sessionId!, db)
  return getSessionStats(sessionId!, db) ?? liveStats(sessionId!, db)
}

const getEngagement = (
  { sessionId }: { sessionId?: string },
  url: URL,
): EngagementStats => computeEngagementStats(sessionId!, resolveDb(url))

const listAllProjects = (): unknown => {
  const active = resolveActiveProject()
  return listProjects().map((p) => ({
    slug: p.slug,
    name: p.name,
    active: p.slug === active.slug,
    lastUsedAt: p.lastUsedAt,
    // Live-session count drives the dashboard's default view (projects with
    // current activity). Handles are cached, so this is a cheap per-poll COUNT.
    liveCount: countLiveSessions(getDbForProject(p.slug)),
  }))
}

const getActiveProjectMeta = (): unknown => {
  const active = resolveActiveProject()
  return { slug: active.slug, name: active.name }
}

// Sessions currently working in a worktree. Derived from the worktree_path
// column the EnterWorktree hook maintains. Scoped like /api/sessions:
// `?projects=` merges the named projects, omitting it covers the active
// project alone.
const listWorktreeSessions = (
  _params: object,
  url: URL,
): SessionWithCategory[] =>
  resolveProjectScope(url)
    .flatMap((project) =>
      getAllSessionsForProject(project, { excludeArchived: true }),
    )
    .filter(({ session }) => session.worktreePath != null)

// /api/worktrees — each row enriched with the branch git *currently* has
// checked out. worktree_branch in the DB is a snapshot from EnterWorktree
// time; a worktree that switched branches mid-life would otherwise display
// its entry-time branch forever. Falls back to the recorded value when git
// can't answer (deleted dir, detached HEAD).
const listWorktrees = (
  _params: object,
  url: URL,
): Promise<WorktreeSessionRow[]> =>
  Promise.all(
    listWorktreeSessions({}, url).map(async (row) => ({
      ...row,
      branch:
        (row.session.worktreePath != null && existsSync(row.session.worktreePath)
          ? await getWorktreeBranch(row.session.worktreePath)
          : null) ?? row.session.worktreeBranch,
    })),
  )

// Dev-server status per worktree-bearing session, keyed by session id. A
// read with no allocation side effects (getWorkspaceServer never reserves a
// port), so polling this from the dashboard doesn't spin up anything — start
// is an explicit action. Statuses resolve in parallel: the observed-port
// check shells out to lsof, but only for sessions with a live process.
const listWorktreeStatus = async (
  _params: object,
  url: URL,
): Promise<Record<string, WorkspaceServerStatus>> => {
  const out: Record<string, WorkspaceServerStatus> = {}
  await Promise.all(
    listWorktreeSessions({}, url).map(async ({ session }) => {
      const status = await getWorkspaceServer(session.id)
      // Self-heal: a worktree dir deleted out from under a session makes its
      // preview meaningless — reclaim the server + port in the background;
      // the next poll reports it idle.
      if (
        session.worktreePath != null &&
        !existsSync(session.worktreePath) &&
        (status.running || status.port != null)
      ) {
        void stopWorkspaceServer(session.id)
      }
      out[session.id] = status
    }),
  )
  return out
}

// Tail of a workspace's dev-server log. `?lines=N` bounds it (default 200,
// NaN falls back). 404s unknown sessions — the id both scopes the request
// (via `?project=`, like the other per-session endpoints) and names a file
// on disk, so it must resolve to a real session before we touch the fs.
const getWorktreeLogs = (
  { sessionId }: { sessionId?: string },
  url: URL,
): Response | { logs: string } => {
  const session = getSession(sessionId!, resolveDb(url))
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 })
  }
  const requested = Number(url.searchParams.get("lines") ?? 200)
  const n = Number.isFinite(requested) ? Math.max(1, requested) : 200
  // Bounded tail read — never the whole file; this is on the 2s poll path.
  return { logs: readWorkspaceLog(session.id, n) }
}

const routes: [RegExp, RouteHandler][] = [
  [/^\/api\/sessions$/, listSessions],
  [/^\/api\/sessions\/(?<id>[^/]+)$/, getSessionById],
  [/^\/api\/worktrees$/, listWorktrees],
  [/^\/api\/worktrees\/status$/, listWorktreeStatus],
  [/^\/api\/worktrees\/(?<sessionId>[^/]+)\/logs$/, getWorktreeLogs],
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

// Start a session's workspace dev server (dashboard "start" button — the same
// lazy trigger as `bertrand open`). Resolves the session against `?project=`
// like every other per-session endpoint (the archive endpoints' "Session not
// found" bug is the cautionary tale), resolves the main checkout for
// BERTRAND_ROOT, then hands off to the 1B manager. Idempotent: a live server
// returns its existing status.
async function handleWorktreeStart(sessionId: string, url: URL): Promise<Response> {
  const session = getSession(sessionId, resolveDb(url))
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 })
  if (!session.worktreePath) {
    return Response.json({ error: "Session has no worktree" }, { status: 409 })
  }
  if (!existsSync(session.worktreePath)) {
    return Response.json({ error: "Worktree path no longer exists" }, { status: 409 })
  }
  const root = await getMainWorktree(session.worktreePath)
  const status = await startWorkspaceServer({
    sessionId: session.id,
    worktreePath: session.worktreePath,
    root,
    slug: session.slug,
  })
  if (!status) {
    return Response.json(
      { error: "No dev command found in worktree" },
      { status: 422 },
    )
  }
  return Response.json(status)
}

const WORKTREE_DELETE_ERROR: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Session not found" },
  "no-worktree": { status: 409, message: "Session has no worktree" },
  active: { status: 409, message: "Session is live — end it before deleting its worktree" },
  dirty: { status: 409, message: "Worktree has uncommitted changes" },
  "git-failed": { status: 500, message: "git worktree remove failed" },
}

// Delete a session's worktree (dashboard "delete" button). The heavy lifting
// — live-session guard, teardown, git removal, record clearing — lives in
// removeSessionWorktree; this handler just parses `force` and maps result
// reasons onto status codes. `dirty` deliberately surfaces as 409 with its
// reason so the client can gate the force retry behind a second confirmation.
async function handleWorktreeDelete(
  sessionId: string,
  url: URL,
  req: Request,
): Promise<Response> {
  let force = false
  try {
    const body = (await req.json()) as { force?: unknown }
    force = body?.force === true
  } catch {
    // no/invalid body — a plain (non-force) delete
  }
  const result = await removeSessionWorktree(sessionId, { force, db: resolveDb(url) })
  if (result.ok) return Response.json({ ok: true })
  const meta = WORKTREE_DELETE_ERROR[result.reason]!
  return Response.json(
    { error: meta.message, reason: result.reason, detail: result.detail },
    { status: meta.status },
  )
}

async function match(pathname: string, url: URL): Promise<Response> {
  for (const [pattern, handler] of routes) {
    const m = pattern.exec(pathname)
    if (!m) continue
    try {
      const result = await handler(m.groups ?? {}, url)
      // Handlers that need a status code return a Response directly;
      // everything else returns data for the JSON-200 default.
      if (result instanceof Response) return result
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

/**
 * Reap workspace servers and port allocations orphaned while nothing was
 * watching — sessions archived from the TUI, worktrees deleted by hand,
 * reboots. Keep = every non-archived, worktree-bearing session across all
 * projects; everything else in the workspace state dir / port registry is
 * reclaimed. Best-effort: reaping must never block serving.
 */
function reapOrphanedWorkspaceState(): void {
  try {
    const keep: string[] = []
    for (const project of listProjects()) {
      const sessions = getAllSessionsForProject(
        { slug: project.slug, name: project.name },
        { excludeArchived: true },
      )
      for (const { session } of sessions) {
        if (session.worktreePath != null) keep.push(session.id)
      }
    }
    void reapOrphanWorkspaces(keep)
  } catch (err) {
    console.error("[server] workspace reap failed:", err)
  }
}

export function startServer(port = PORT) {
  reapOrphanedWorkspaceState()
  const server = Bun.serve({
    port,
    // Loopback only. The API has no auth, answers with CORS *, and now
    // includes state-changing endpoints that spawn processes and expose dev
    // logs — none of which should be reachable from the LAN.
    hostname: "127.0.0.1",
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
        const startMatch = /^\/api\/worktrees\/([^/]+)\/start$/.exec(url.pathname)
        if (startMatch) {
          const r = await handleWorktreeStart(startMatch[1]!, url)
          r.headers.set("Access-Control-Allow-Origin", "*")
          return r
        }
        const stopMatch = /^\/api\/worktrees\/([^/]+)\/stop$/.exec(url.pathname)
        if (stopMatch) {
          // Validate the id resolves to a real session (scoped via ?project=
          // like start) before acting on files/processes keyed by it. Stop
          // itself stays best-effort — a session whose worktree is already
          // gone must still be stoppable for cleanup.
          const session = getSession(stopMatch[1]!, resolveDb(url))
          if (!session) {
            const r = Response.json({ error: "Session not found" }, { status: 404 })
            r.headers.set("Access-Control-Allow-Origin", "*")
            return r
          }
          // Awaited: stop only resolves once the process is confirmed dead
          // (or SIGKILLed), so the client's follow-up status read is truthful.
          await stopWorkspaceServer(session.id)
          const r = Response.json({ ok: true })
          r.headers.set("Access-Control-Allow-Origin", "*")
          return r
        }
        const deleteMatch = /^\/api\/worktrees\/([^/]+)\/delete$/.exec(url.pathname)
        if (deleteMatch) {
          const r = await handleWorktreeDelete(deleteMatch[1]!, url, req)
          r.headers.set("Access-Control-Allow-Origin", "*")
          return r
        }
        const archiveMatch = /^\/api\/sessions\/([^/]+)\/archive$/.exec(url.pathname)
        if (archiveMatch) {
          const response = archiveResponse(archiveSession(archiveMatch[1]!, resolveDb(url)))
          response.headers.set("Access-Control-Allow-Origin", "*")
          return response
        }
        const unarchiveMatch = /^\/api\/sessions\/([^/]+)\/unarchive$/.exec(url.pathname)
        if (unarchiveMatch) {
          const response = archiveResponse(unarchiveSession(unarchiveMatch[1]!, resolveDb(url)))
          response.headers.set("Access-Control-Allow-Origin", "*")
          return response
        }
      }

      if (url.pathname.startsWith("/api/")) {
        const response = await match(url.pathname, url)
        response.headers.set("Access-Control-Allow-Origin", "*")
        return response
      }

      const dashboardResponse = await serveDashboard(url.pathname)
      if (dashboardResponse) return dashboardResponse

      const response = await match(url.pathname, url)
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
