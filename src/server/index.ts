import { execFile } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { tryUpgradeTerminal, terminalWebSocketHandlers } from "./terminal-relay"
import { recoverStaleSessions } from "@/lib/session-recovery"
import { type ChangedFile } from "@/lib/git"
import { getAllSessions, getSession } from "@/db/queries/sessions"
import { getEventsBySession, getEventsByType, getMaxEventId } from "@/db/queries/events"
import { getSessionStats } from "@/db/queries/stats"
import { computeSessionStats, computeAndPersist } from "@/lib/timing"
import { resolveChangedFiles } from "@/lib/diff_stats"
import { computeEngagementStats } from "@/lib/engagement_stats"
import {
  archiveSession,
  unarchiveSession,
  type ArchiveResult,
  type UnarchiveResult,
} from "@/lib/session-archive"
import { discardSession, type DiscardResult } from "@/lib/session-actions"
import { getPRForBranch } from "@/lib/github/pr"
import { resolveRepoAt } from "@/lib/github/resolve"
import { resolveSessionPullRequest } from "@/lib/github/session-pr"
import type {
  SessionRow,
  SessionListRow,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  SessionPullRequest,
} from "@/types"

const PORT = Number(process.env.BERTRAND_PORT ?? 5200)

/**
 * The PTY engine, loaded on demand (ELKY-176).
 *
 * `bertrand serve` runs for the whole of every recorded session — the
 * UserPromptSubmit hook restarts it if it goes away — so a static import here
 * would put `src/engine` on the recording path of every session, including the
 * ones bertrand never launched. Only the three dashboard-owned-session routes
 * below need it, and each already runs in an async context.
 *
 * `import()` caches, so the repeat cost after the first spawn is a resolved
 * promise. Keep this the only door into `src/engine` from the server;
 * `src/layer-boundary.test.ts` fails if a static one comes back.
 */
const dashboardSessions = () => import("@/engine/dashboard-session")

type RouteHandler = (params: Record<string, string | undefined>, url: URL) => unknown

/**
 * Live stats are recomputed from a full event walk (timings + diff parse over
 * every meta blob), and the dashboard polls them every 2s per live session.
 * Events are append-only, so max(event.id) is a complete change token — cache
 * the last result per session and only recompute when the log actually grew.
 * Unbounded but tiny: one row per session ever polled this process.
 */
const liveStatsCache = new Map<string, { maxId: number; row: SessionStatsRow }>()

function liveStats(sessionId: string): SessionStatsRow {
  const maxId = getMaxEventId(sessionId)
  const cached = liveStatsCache.get(sessionId)
  if (cached && cached.maxId === maxId) return cached.row
  const row: SessionStatsRow = {
    sessionId,
    ...computeSessionStats(sessionId),
    updatedAt: new Date().toISOString(),
  }
  liveStatsCache.set(sessionId, { maxId, row })
  return row
}

/**
 * Fallback for a non-live session missing its materialized session_stats row
 * (sessions ended before stats persistence existed, or by a crash). Computing
 * is unavoidable once, but persisting the result means it's once — not on
 * every 2s poll forever.
 */
function backfilledStats(sessionId: string): SessionStatsRow {
  return {
    sessionId,
    ...computeAndPersist(sessionId),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * The directory a session's *recorded file paths* are relative to.
 *
 * Read off the session row, not out of a registry. This used to be the bound
 * repo path of whichever project the request named, which could easily be a
 * different checkout than the session ever touched — and then every path in
 * the response rendered absolute, because the prefix being stripped wasn't the
 * prefix the paths carried. `worktreeRoot` is where `claude` actually ran, so it
 * is that prefix by construction; `mainCheckout` only stands in for a session
 * whose worktree was never recorded.
 *
 * `undefined` rather than null: the callee reads an absent root as "leave the
 * path absolute", which is the correct rendering for a session outside git.
 */
function displayRoot(session: SessionRow): string | undefined {
  return session.worktreeRoot ?? session.mainCheckout ?? undefined
}

/**
 * The checkout a session's *repo identity* should be resolved in.
 *
 * The opposite preference to {@link displayRoot}, and deliberately so: this
 * path only has to still exist and still name the repo, and a linked worktree
 * frequently does not. An Orca workspace is deleted the moment its task lands,
 * which would leave a paused session's PR permanently unresolvable — while the
 * main checkout behind it is a long-lived clone of the same repo with the same
 * `origin`. Falls back to the worktree for a session that has no main checkout
 * recorded.
 */
function repoRoot(session: SessionRow): string | undefined {
  return session.mainCheckout ?? session.worktreeRoot ?? undefined
}

/**
 * Every session in one list. There is a single DB now, so there is no scope to
 * resolve and no `?projects=` to honour: the rollup a client wants (repo →
 * session → conversation) is derivable from `repo`/`branch`/`groupKey`, which
 * ride along on each row straight out of the schema.
 */
const listSessions = (_params: object, url: URL): SessionListRow[] => {
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
  // `?sinceId=N` returns only rows with id > N — the dashboard's live poll
  // passes the max id it has seen so idle ticks cost ~0 bytes instead of the
  // full timeline. Invalid/absent values fall back to the full list.
  const sinceParam = Number(url.searchParams.get("sinceId"))
  const sinceId = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : undefined
  // The explicit `undefined` skips the query's `db` parameter — a test-injection
  // seam that defaults to `getDb()` — to reach the options after it.
  return getEventsBySession(sessionId!, undefined, { sinceId })
}

const listAllStats = (): Record<string, SessionStatsRow> => {
  const result: Record<string, SessionStatsRow> = {}
  for (const { session } of getAllSessions()) {
    const isLive =
      session.status === "active" ||
      session.status === "waiting" ||
      session.status === "blocked"
    if (isLive) {
      result[session.id] = liveStats(session.id)
      continue
    }
    result[session.id] =
      getSessionStats(session.id) ?? backfilledStats(session.id)
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
  const isLive = session.status === "active" ||
        session.status === "waiting" ||
        session.status === "blocked"
  if (isLive) return liveStats(sessionId!)
  return getSessionStats(sessionId!) ?? backfilledStats(sessionId!)
}

// /api/stats/:sessionId/files — the individual files a session changed, with
// per-file line counts, replayed from the session's own timeline. Covers every
// session uniformly now that worktrees are gone. A missing session answers
// "nothing changed" so the sidebar can poll quietly.
const getChangedFilesBySession = ({
  sessionId,
}: {
  sessionId?: string
}): Promise<ChangedFile[]> => {
  const session = getSession(sessionId!)
  if (!session) return Promise.resolve([])
  return resolveChangedFiles(session, displayRoot(session))
}

const getEngagement = ({
  sessionId,
}: {
  sessionId?: string
}): EngagementStats => computeEngagementStats(sessionId!)

// /api/github/:sessionId/pr — the pull request for the session's branch, with
// its check rollup. The decisions (which branch, which checkout, and what
// counts as "GitHub didn't answer") live in @/lib/github/session-pr; this is
// the adapter that hands it the session row and the real I/O.
//
// An unknown session answers "no PR" rather than 404ing. The sidebar polls
// this, and every arm of the response already means "render nothing" except
// the one where a PR exists — so a missing session has a correct answer, and
// erroring would make a torn-down session louder than a live one.
//
// No route-level cache: `getPRForBranch` TTL-caches per branch and coalesces
// concurrent lookups, so N sessions on one branch still cost one `gh`.
const getSessionPullRequest = ({
  sessionId,
}: {
  sessionId?: string
}): Promise<SessionPullRequest> => {
  const session = getSession(sessionId!)
  if (!session) return Promise.resolve({ status: "none" })
  return resolveSessionPullRequest(
    {
      // Both recorded at session start from the cwd, and both null for a
      // session whose cwd was not in a git repo — which answers `none`, not an
      // error. `repoRoot` prefers the main checkout over the worktree; see
      // there for why a torn-down workspace must not lose the PR.
      branch: session.branch,
      repoPath: repoRoot(session),
    },
    {
      resolveRepo: resolveRepoAt,
      lookupPR: getPRForBranch,
    },
  )
}

const routes: [RegExp, RouteHandler][] = [
  [/^\/api\/sessions$/, listSessions],
  [/^\/api\/sessions\/(?<id>[^/]+)$/, getSessionById],
  [/^\/api\/github\/(?<sessionId>[^/]+)\/pr$/, getSessionPullRequest],
  [/^\/api\/events\/(?<sessionId>[^/]+)$/, listEvents],
  [/^\/api\/stats$/, listAllStats],
  [/^\/api\/stats\/(?<sessionId>[^/]+)\/files$/, getChangedFilesBySession],
  [/^\/api\/stats\/(?<sessionId>[^/]+)$/, getStatsBySession],
  [/^\/api\/engagement\/(?<sessionId>[^/]+)$/, getEngagement],
]

/**
 * The Vite dev server's port. Must match `server.port` in
 * `dashboard/vite.config.ts` — the dev server proxies `/api` and `/ws` here, so
 * a browser on that page sends its own origin along with any POST.
 */
const VITE_DEV_PORT = 5199

const loopbackOrigins = (port: number): string[] => [
  `http://localhost:${port}`,
  `http://127.0.0.1:${port}`,
]

/**
 * Origins permitted to talk to this server.
 *
 * The API is unauthenticated and includes state-changing routes that spawn
 * processes (`/api/open`, `/api/sessions/spawn`), so the blanket `*` this used
 * to answer with let any page the user happened to have open drive them.
 * Loopback binding is no defence there — the browser is itself a local process.
 * The server now runs continuously rather than only alongside a live session,
 * which would have made that an always-open window.
 *
 * Deliberately an exact-match set rather than a "trust all of localhost"
 * pattern: only the two pages that actually exist are named — the bundled
 * dashboard on this server's own port (so it follows `BERTRAND_PORT`) and the
 * Vite dev server. The tradeoff is that a dev server which falls back to
 * another port because {@link VITE_DEV_PORT} is busy will be refused; fix that
 * by freeing the port rather than by widening this set.
 */
const ALLOWED_ORIGINS = new Set([
  "https://bertrand.sh",
  ...loopbackOrigins(PORT),
  ...loopbackOrigins(VITE_DEV_PORT),
])

/**
 * The value to echo back in `Access-Control-Allow-Origin`, or null when the
 * request needs no CORS header at all (same-origin browser requests omit
 * `Origin`, as do curl and the TUI).
 */
function corsOrigin(origin: string | null): string | null {
  if (!origin) return null
  return ALLOWED_ORIGINS.has(origin) ? origin : null
}

/** Echo an allowlisted origin onto a response. No-op when there's nothing to echo. */
function applyCors(response: Response, origin: string | null): Response {
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin)
    // Responses now differ by origin, so shared caches must key on it.
    response.headers.set("Vary", "Origin")
  }
  return response
}

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

const SESSION_ACTION_ERROR: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Session not found" },
  active: { status: 409, message: "Stop the session before discarding it" },
}

function sessionActionResponse(
  result: DiscardResult,
  body: unknown = { ok: true },
): Response {
  if (result.ok) return Response.json(body)
  const meta = SESSION_ACTION_ERROR[result.reason] ?? {
    status: 400,
    message: "Operation failed",
  }
  return Response.json({ error: meta.message, reason: result.reason }, { status: meta.status })
}

/**
 * Every way a resume can be refused, and what the browser should be told.
 *
 * Each carries a message the user can act on. "At capacity" especially: it is
 * a real, temporary, self-inflicted condition with an obvious remedy, and
 * surfacing it as an opaque 500 would leave someone staring at a dead button
 * with no idea that stopping another session fixes it.
 */
const RESUME_ERROR: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Session not found" },
  "conversation-not-found": {
    status: 404,
    message: "That conversation does not belong to this session",
  },
  "already-running": {
    status: 409,
    message: "This session is already running — attach to it instead",
  },
  "no-cwd": {
    status: 409,
    message:
      "Cannot tell which directory this session ran in, or it no longer exists. " +
      "Resume it from the CLI in the right directory.",
  },
}

/**
 * Resume a session under the server's ownership (#214). Body may carry a
 * `conversationId` to continue; omitted starts a new conversation under the
 * same session, matching the TUI resume picker's "+ New conversation".
 */
async function handleResumeSession(id: string, req: Request): Promise<Response> {
  // An empty body is legitimate here — it means "new conversation" — so a
  // failed parse is not an error here.
  let body: { conversationId?: unknown } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    body = {}
  }

  const { conversationId } = body
  if (conversationId !== undefined && typeof conversationId !== "string") {
    return Response.json(
      { error: "conversationId must be a string when provided" },
      { status: 400 },
    )
  }

  const { resumeDashboardSession } = await dashboardSessions()
  const result = resumeDashboardSession({ sessionId: id, conversationId })
  if (result.ok) {
    return Response.json({
      sessionId: result.sessionId,
      claudeId: result.claudeId,
      pid: result.pid,
    })
  }

  if (result.reason === "at-capacity") {
    return Response.json(
      {
        // Phrased against the limit rather than a live count: they are equal
        // whenever this fires, and naming the limit still reads correctly if
        // the cap is configured to 0.
        error:
          `Already at the limit of ${result.limit} concurrent dashboard ` +
          `sessions. Stop one before resuming this session, or raise ` +
          `BERTRAND_MAX_DASHBOARD_SESSIONS.`,
        reason: result.reason,
        limit: result.limit,
      },
      { status: 503 },
    )
  }

  const meta = RESUME_ERROR[result.reason] ?? {
    status: 400,
    message: "Could not resume this session",
  }
  return Response.json(
    { error: meta.message, reason: result.reason },
    { status: meta.status },
  )
}

/**
 * Spawn a session whose PTY this server owns (issue #207). Unlike a
 * CLI-started session there is no terminal involved at all — the browser that
 * attaches becomes the sole sizing authority.
 *
 * The body still carries no path, and must not start doing so: a
 * client-supplied directory would let any page the browser has open pick where
 * `claude` runs. Choosing the working directory is `src/engine`'s decision —
 * this handler only validates the naming arguments and translates the engine's
 * refusals into status codes.
 */
async function handleSpawnDashboardSession(req: Request): Promise<Response> {
  let body: {
    slug?: unknown
    name?: unknown
    baseBranch?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Slug is optional: a slugless spawn starts on a placeholder and pause-time
  // derivation names it for real. Present-but-malformed is still refused.
  const { slug } = body
  if (slug !== undefined && (typeof slug !== "string" || !slug)) {
    return Response.json(
      { error: "slug must be a non-empty string when provided" },
      { status: 400 },
    )
  }
  // A display name on a slugless spawn would be marked 'derived' and replaced
  // by the derived slug at the first pause. Refuse rather than lose it.
  if (body.name !== undefined && slug === undefined) {
    return Response.json(
      { error: "name requires slug — a slugless session is named at pause" },
      { status: 400 },
    )
  }

  // Resolved before the try so the catch below can reach the error class the
  // same module exports.
  const { spawnDashboardSession, DashboardSessionLimitError } = await dashboardSessions()

  try {
    const result = await spawnDashboardSession({
      slug,
      name: typeof body.name === "string" ? body.name : undefined,
    })
    return Response.json(result)
  } catch (err) {
    // At capacity is a client-visible condition with a retry story, not a
    // server fault — 503 so a UI can say "too many sessions" rather than
    // surfacing an opaque 500.
    if (err instanceof DashboardSessionLimitError) {
      return Response.json({ error: err.message, limit: err.limit }, { status: 503 })
    }
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
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
 * Reconcile sessions left `active` with a dead pid (#209).
 *
 * A dashboard-owned `claude` dies with the server that spawned it — its PTY
 * master lives in this process, so a serve restart SIGHUPs it. What survives
 * the restart is the row, still marked active and pointing at a pid the OS is
 * free to recycle. Nothing else runs this on the server side: recovery was
 * previously wired only into `bertrand launch`, so a user who never touched
 * the CLI accumulated stale rows indefinitely.
 *
 * Best-effort and non-blocking, like the workspace reap above — boot must not
 * wait on `ps`.
 */
function recoverStaleSessionRows(): void {
  void recoverStaleSessions().then(
    (n) => {
      if (n > 0) console.log(`[server] recovered ${n} stale session(s)`)
    },
    (err) => console.error("[server] session recovery failed:", err),
  )
}

export function startServer(port = PORT) {
  // A worktree preview can boot this same server as its API sidecar (the
  // `api` workspace script; BERTRAND_WORKSPACE is set in that env). Global
  // sweeps are the shared server's boot duty — a sidecar running branch code
  // must not reap other sessions' servers or rewrite the port registry based
  // on the branch's view of the world.
  if (!process.env.BERTRAND_WORKSPACE) {
    recoverStaleSessionRows()
  }
  const server = Bun.serve({
    port,
    // Loopback only. The API has no auth, answers with CORS *, and now
    // includes state-changing endpoints that spawn processes and expose dev
    // logs — none of which should be reachable from the LAN.
    hostname: "127.0.0.1",
    websocket: terminalWebSocketHandlers,
    async fetch(req, server) {
      const url = new URL(req.url)

      const requestOrigin = req.headers.get("origin")
      const allowOrigin = corsOrigin(requestOrigin)

      // Refuse an untrusted cross-origin request outright rather than merely
      // withholding its response. Two independent reasons this cannot be a
      // response-header-only policy:
      //
      //   - CORS gates *reading* a reply, not sending the request. A "simple"
      //     POST (text/plain body, no preflight) is still delivered, so
      //     `/api/open` and `/api/sessions/spawn` would run for their side
      //     effect and only the answer would be withheld.
      //   - WebSockets aren't governed by CORS at all. The check therefore has
      //     to precede the upgrade below, or any page could attach to the
      //     terminal relay — reading a session's output and writing its input.
      //
      // Non-browser callers (the relay's own upstream client, the TUI, curl)
      // send no Origin at all and pass straight through.
      if (requestOrigin && !allowOrigin) {
        return new Response("Forbidden origin", { status: 403 })
      }

      const wsResult = tryUpgradeTerminal(req, server, url)
      if (wsResult !== false) return wsResult

      if (req.method === "OPTIONS") {
        return applyCors(
          new Response(null, {
            headers: {
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          }),
          allowOrigin,
        )
      }

      // Hand off to the platform `open` binary. macOS-only for now; runs
      // server-side so the browser doesn't need to expose file:// access.
      if (req.method === "POST" && url.pathname === "/api/open") {
        const r = await handleOpen(req)
        applyCors(r, allowOrigin)
        return r
      }

      // Dashboard-owned sessions (issue #207): the server spawns the PTY, so
      // the browser is the only viewer and the sole sizing authority.
      if (req.method === "POST" && url.pathname === "/api/sessions/spawn") {
        const r = await handleSpawnDashboardSession(req)
        applyCors(r, allowOrigin)
        return r
      }

      if (req.method === "POST") {
        const stopSessionMatch = /^\/api\/sessions\/([^/]+)\/stop$/.exec(url.pathname)
        if (stopSessionMatch) {
          const { stopDashboardSession } = await dashboardSessions()
          const stopped = stopDashboardSession(stopSessionMatch[1]!)
          return applyCors(
            Response.json({ stopped }, { status: stopped ? 200 : 404 }),
            allowOrigin,
          )
        }
      }

      if (req.method === "POST") {
        const archiveMatch = /^\/api\/sessions\/([^/]+)\/archive$/.exec(url.pathname)
        if (archiveMatch) {
          const response = archiveResponse(archiveSession(archiveMatch[1]!))
          applyCors(response, allowOrigin)
          return response
        }
        const unarchiveMatch = /^\/api\/sessions\/([^/]+)\/unarchive$/.exec(url.pathname)
        if (unarchiveMatch) {
          const response = archiveResponse(unarchiveSession(unarchiveMatch[1]!))
          applyCors(response, allowOrigin)
          return response
        }
        // End-of-session actions the TUI exit screen has always had and the
        // dashboard did not (#214). Archive above is shared with it as-is.
        const resumeMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(url.pathname)
        if (resumeMatch) {
          const r = await handleResumeSession(resumeMatch[1]!, req)
          applyCors(r, allowOrigin)
          return r
        }
        const discardMatch = /^\/api\/sessions\/([^/]+)\/discard$/.exec(url.pathname)
        if (discardMatch) {
          const response = sessionActionResponse(discardSession(discardMatch[1]!))
          applyCors(response, allowOrigin)
          return response
        }
      }

      if (url.pathname.startsWith("/api/")) {
        const response = await match(url.pathname, url)
        applyCors(response, allowOrigin)
        return response
      }

      const dashboardResponse = await serveDashboard(url.pathname)
      if (dashboardResponse) return dashboardResponse

      const response = await match(url.pathname, url)
      applyCors(response, allowOrigin)
      return response
    },
  })

  const dashboardNote = DASHBOARD_DIR ? " (with bundled dashboard)" : ""
  console.log(
    `bertrand API server listening on http://localhost:${server.port}${dashboardNote}`,
  )
  return server
}
