import { execFile } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { tryUpgradeTerminal, terminalWebSocketHandlers } from "./terminal-relay"
import {
  DashboardSessionLimitError,
  WorktreeCreateError,
  spawnDashboardSession,
  resumeDashboardSession,
  stopDashboardSession,
} from "@/engine/dashboard-session"
import type { CreateWorktreeReason } from "@/lib/worktree-create"
import { recoverStaleSessions } from "@/engine/recovery"
import {
  getMainWorktree,
  getWorktreeBranch,
  getWorktreeChangedFiles,
  type ChangedFile,
  type WorktreeChangedFiles,
} from "@/lib/git"
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
import { getEventsBySession, getEventsByType, getMaxEventId } from "@/db/queries/events"
import { getSessionStats } from "@/db/queries/stats"
import { computeSessionStats, computeAndPersist } from "@/lib/timing"
import { computeChangedFiles } from "@/lib/diff_stats"
import { computeEngagementStats } from "@/lib/engagement_stats"
import {
  archiveSession,
  unarchiveSession,
  type ArchiveResult,
  type UnarchiveResult,
} from "@/lib/session-archive"
import {
  rateSession,
  discardSession,
  type RateResult,
  type DiscardResult,
} from "@/lib/session-actions"
import { removeSessionWorktree } from "@/lib/worktree-remove"
import {
  listProjects,
  setActiveProjectSlug,
  projectExists,
  getProjectRepo,
  type ProjectRepo,
} from "@/lib/projects/registry"
import { formatIdentity } from "@/lib/github/identity"
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
  ProjectRepoView,
  ProjectSummary,
  ActiveProjectMeta,
} from "@/types"

const PORT = Number(process.env.BERTRAND_PORT ?? 5200)

type RouteHandler = (params: Record<string, string | undefined>, url: URL) => unknown

/**
 * Live stats are recomputed from a full event walk (timings + diff parse over
 * every meta blob), and the dashboard polls them every 2s per live session.
 * Events are append-only, so max(event.id) is a complete change token — cache
 * the last result per session and only recompute when the log actually grew.
 * Session ids are globally unique nanoids, so one map is safe across project
 * DBs. Unbounded but tiny: one row per session ever polled this process.
 */
const liveStatsCache = new Map<string, { maxId: number; row: SessionStatsRow }>()

function liveStats(sessionId: string, db?: Db): SessionStatsRow {
  const maxId = getMaxEventId(sessionId, db)
  const cached = liveStatsCache.get(sessionId)
  if (cached && cached.maxId === maxId) return cached.row
  const row: SessionStatsRow = {
    sessionId,
    ...computeSessionStats(sessionId, db),
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
function backfilledStats(sessionId: string, db?: Db): SessionStatsRow {
  return {
    sessionId,
    ...computeAndPersist(sessionId, db),
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
        getSessionStats(session.id, db) ?? backfilledStats(session.id, db)
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
  return getSessionStats(sessionId!, db) ?? backfilledStats(sessionId!, db)
}

// /api/stats/:sessionId/files — the individual files a session changed, with
// per-file line counts, derived from its timeline (not git). Mirrors the
// primary sidebar's file-count/+- totals and covers every session whether or
// not a worktree exists. A missing session answers "nothing changed" so the
// sidebar can poll quietly.
const getChangedFilesBySession = (
  { sessionId }: { sessionId?: string },
  url: URL,
): ChangedFile[] => {
  const db = resolveDb(url)
  const session = getSession(sessionId!, db)
  if (!session) return []
  return computeChangedFiles(sessionId!, db)
}

const getEngagement = (
  { sessionId }: { sessionId?: string },
  url: URL,
): EngagementStats => computeEngagementStats(sessionId!, resolveDb(url))

/** Widen a stored binding into its wire form, or `null` when unbound. */
const toRepoView = (repo: ProjectRepo | undefined): ProjectRepoView | null =>
  repo ? { ...repo, label: formatIdentity(repo.provider) } : null

const listAllProjects = (): ProjectSummary[] => {
  const active = resolveActiveProject()
  return listProjects().map((p) => ({
    slug: p.slug,
    name: p.name,
    active: p.slug === active.slug,
    lastUsedAt: p.lastUsedAt,
    // Live-session count drives the dashboard's default view (projects with
    // current activity). Handles are cached, so this is a cheap per-poll COUNT.
    liveCount: countLiveSessions(getDbForProject(p.slug)),
    repo: toRepoView(p.repo),
  }))
}

const getActiveProjectMeta = (): ActiveProjectMeta => {
  const active = resolveActiveProject()
  // The binding is read from the registry rather than taken off `active`:
  // resolveActiveProject memoizes for the whole process lifetime, so a
  // `bertrand project link` during a long-lived server would otherwise not
  // show up until restart. Registry reads hit disk each call, so this is
  // always current.
  return {
    slug: active.slug,
    name: active.name,
    repo: toRepoView(getProjectRepo(active.slug)),
  }
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

/**
 * Current checked-out branch per worktree, cached briefly. The lookup is a
 * git subprocess per worktree and sits on the dashboard's 2s poll; branch
 * switches are rare enough that a short TTL trades a few seconds of staleness
 * for not forking git 30× a minute per worktree.
 */
const BRANCH_TTL_MS = 15_000
const branchCache = new Map<string, { at: number; branch: string | null }>()

async function cachedWorktreeBranch(worktreePath: string): Promise<string | null> {
  const cached = branchCache.get(worktreePath)
  if (cached && Date.now() - cached.at < BRANCH_TTL_MS) return cached.branch
  const branch = await getWorktreeBranch(worktreePath)
  branchCache.set(worktreePath, { at: Date.now(), branch })
  return branch
}

// /api/worktrees — one scan produces everything the dashboard's worktree UI
// needs: each row enriched with the branch git *currently* has checked out
// (worktree_branch in the DB is an EnterWorktree-time snapshot; falls back to
// it when git can't answer — deleted dir, detached HEAD) plus the dev-server
// preview status. Status reads have no allocation side effects
// (getWorkspaceServer never reserves a port), so polling doesn't spin
// anything up; the observed-port check shells out to lsof, but only for
// sessions with a live process.
const listWorktrees = (
  _params: object,
  url: URL,
): Promise<WorktreeSessionRow[]> =>
  Promise.all(
    listWorktreeSessions({}, url).map(async (row) => {
      const { session } = row
      const exists =
        session.worktreePath != null && existsSync(session.worktreePath)
      const [branch, status] = await Promise.all([
        exists ? cachedWorktreeBranch(session.worktreePath!) : null,
        getWorkspaceServer(session.id),
      ])
      // Self-heal: a worktree dir deleted out from under a session makes its
      // preview meaningless — reclaim the server + port in the background;
      // the next poll reports it idle.
      if (!exists && (status.running || status.port != null)) {
        void stopWorkspaceServer(session.id)
      }
      return { ...row, branch: branch ?? session.worktreeBranch, status }
    }),
  )

// Back-compat projection of /api/worktrees for clients that still poll the
// status map separately (a hosted SPA older than this server).
const listWorktreeStatus = async (
  params: object,
  url: URL,
): Promise<Record<string, WorkspaceServerStatus>> => {
  const out: Record<string, WorkspaceServerStatus> = {}
  for (const row of await listWorktrees(params, url)) {
    out[row.session.id] = row.status
  }
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

/**
 * Changed files for a session's worktree, cached briefly like branches: the
 * lookup forks a few git subprocesses and sits on the secondary sidebar's
 * poll, and diffs don't change faster than the TTL matters.
 */
const FILES_TTL_MS = 3_000
const filesCache = new Map<string, { at: number; result: WorktreeChangedFiles }>()

async function cachedWorktreeFiles(
  worktreePath: string,
  uncommittedOnly: boolean,
): Promise<WorktreeChangedFiles> {
  const key = `${worktreePath}#${uncommittedOnly ? "uncommitted" : "branch"}`
  const cached = filesCache.get(key)
  if (cached && Date.now() - cached.at < FILES_TTL_MS) return cached.result
  const result = await getWorktreeChangedFiles(worktreePath, { uncommittedOnly })
  filesCache.set(key, { at: Date.now(), result })
  return result
}

// /api/worktrees/:sessionId/files — what the session's worktree changed
// relative to its merge base with the main branch, or `?scope=uncommitted`
// for only what a force-removal would discard. A missing/deleted worktree
// answers "nothing changed" rather than erroring: the sidebar keeps polling
// while a worktree is torn down, and an error there is noise, not signal.
const getWorktreeFiles = (
  { sessionId }: { sessionId?: string },
  url: URL,
): Response | Promise<WorktreeChangedFiles> => {
  const session = getSession(sessionId!, resolveDb(url))
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 })
  }
  if (!session.worktreePath || !existsSync(session.worktreePath)) {
    return Promise.resolve({ base: null, files: [] })
  }
  const uncommittedOnly = url.searchParams.get("scope") === "uncommitted"
  return cachedWorktreeFiles(session.worktreePath, uncommittedOnly)
}

const routes: [RegExp, RouteHandler][] = [
  [/^\/api\/sessions$/, listSessions],
  [/^\/api\/sessions\/(?<id>[^/]+)$/, getSessionById],
  [/^\/api\/worktrees$/, listWorktrees],
  [/^\/api\/worktrees\/status$/, listWorktreeStatus],
  [/^\/api\/worktrees\/(?<sessionId>[^/]+)\/logs$/, getWorktreeLogs],
  [/^\/api\/worktrees\/(?<sessionId>[^/]+)\/files$/, getWorktreeFiles],
  [/^\/api\/events\/(?<sessionId>[^/]+)$/, listEvents],
  [/^\/api\/stats$/, listAllStats],
  [/^\/api\/stats\/(?<sessionId>[^/]+)\/files$/, getChangedFilesBySession],
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

const SESSION_ACTION_ERROR: Record<string, { status: number; message: string }> = {
  "not-found": { status: 404, message: "Session not found" },
  "out-of-range": { status: 400, message: "Rating must be an integer 1-5, or null to clear" },
  active: { status: 409, message: "Stop the session before discarding it" },
}

function sessionActionResponse(
  result: RateResult | DiscardResult,
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
 * Set or clear a session's 1-5 rating — the dashboard's equivalent of the TUI
 * exit screen's number keys (#214). `rating: null` clears it.
 */
async function handleRateSession(id: string, url: URL, req: Request): Promise<Response> {
  let body: { rating?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { rating } = body
  // Only a number or an explicit null are meaningful. Anything else — including
  // a missing key — is rejected rather than silently read as "clear", which
  // would turn a malformed request into data loss.
  if (rating !== null && typeof rating !== "number") {
    return Response.json(
      { error: "rating must be a number 1-5, or null to clear", reason: "out-of-range" },
      { status: 400 },
    )
  }

  const result = rateSession(id, rating, resolveDb(url))
  return sessionActionResponse(result, result.ok ? result.session : undefined)
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
  // failed parse is not an error the way it is for rating.
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
 * Worktree creation failures, mapped to statuses a caller can act on (#210).
 *
 * Same reasoning as RESUME_ERROR above: a name that collides with an existing
 * branch is the caller's to fix and reads as a conflict, not a server fault.
 * Only git failing outright is a 500.
 */
const SPAWN_WORKTREE_STATUS: Record<CreateWorktreeReason, number> = {
  "not-a-repo": 400,
  "path-exists": 409,
  "branch-exists": 409,
  "git-failed": 500,
}

/**
 * Spawn a session whose PTY this server owns (issue #207). Unlike a
 * CLI-started session there is no terminal involved at all — the caller
 * supplies the repo, and the browser that attaches becomes the sole sizing
 * authority.
 *
 * `cwd` is the repository the session works in, not the directory `claude`
 * runs in: every dashboard session gets its own worktree under that repo's
 * main checkout (#210), and the worktree is the working directory.
 */
async function handleSpawnDashboardSession(req: Request): Promise<Response> {
  let body: {
    categoryPath?: unknown
    slug?: unknown
    name?: unknown
    cwd?: unknown
    baseBranch?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { categoryPath, slug, cwd, baseBranch } = body
  if (typeof categoryPath !== "string" || !categoryPath) {
    return Response.json({ error: "categoryPath must be a non-empty string" }, { status: 400 })
  }
  if (typeof slug !== "string" || !slug) {
    return Response.json({ error: "slug must be a non-empty string" }, { status: 400 })
  }
  if (typeof cwd !== "string" || !cwd.startsWith("/") || !existsSync(cwd)) {
    return Response.json(
      { error: "cwd must be an existing absolute path to a git repository" },
      { status: 400 },
    )
  }
  if (baseBranch !== undefined && (typeof baseBranch !== "string" || !baseBranch)) {
    return Response.json(
      { error: "baseBranch must be a non-empty string when provided" },
      { status: 400 },
    )
  }

  try {
    const result = await spawnDashboardSession({
      categoryPath,
      slug,
      name: typeof body.name === "string" ? body.name : undefined,
      cwd,
      baseBranch,
    })
    return Response.json(result)
  } catch (err) {
    // At capacity is a client-visible condition with a retry story, not a
    // server fault — 503 so a UI can say "too many sessions" rather than
    // surfacing an opaque 500.
    if (err instanceof DashboardSessionLimitError) {
      return Response.json({ error: err.message, limit: err.limit }, { status: 503 })
    }
    // The worktree could not be created, so no session exists. The reason
    // travels with the error so a form can point at the field that caused it
    // rather than showing a generic failure.
    if (err instanceof WorktreeCreateError) {
      return Response.json(
        { error: err.message, reason: err.reason, detail: err.detail },
        { status: SPAWN_WORKTREE_STATUS[err.reason] },
      )
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
    reapOrphanedWorkspaceState()
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

      const wsResult = tryUpgradeTerminal(req, server, url)
      if (wsResult !== false) return wsResult

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

      // Dashboard-owned sessions (issue #207): the server spawns the PTY, so
      // the browser is the only viewer and the sole sizing authority.
      if (req.method === "POST" && url.pathname === "/api/sessions/spawn") {
        const r = await handleSpawnDashboardSession(req)
        r.headers.set("Access-Control-Allow-Origin", "*")
        return r
      }

      if (req.method === "POST") {
        const stopSessionMatch = /^\/api\/sessions\/([^/]+)\/stop$/.exec(url.pathname)
        if (stopSessionMatch) {
          const stopped = stopDashboardSession(stopSessionMatch[1]!)
          return Response.json(
            { stopped },
            { status: stopped ? 200 : 404, headers: { "Access-Control-Allow-Origin": "*" } },
          )
        }
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
        // End-of-session actions the TUI exit screen has always had and the
        // dashboard did not (#214). Archive above is shared with it as-is.
        const rateMatch = /^\/api\/sessions\/([^/]+)\/rating$/.exec(url.pathname)
        if (rateMatch) {
          const r = await handleRateSession(rateMatch[1]!, url, req)
          r.headers.set("Access-Control-Allow-Origin", "*")
          return r
        }
        const resumeMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(url.pathname)
        if (resumeMatch) {
          const r = await handleResumeSession(resumeMatch[1]!, req)
          r.headers.set("Access-Control-Allow-Origin", "*")
          return r
        }
        const discardMatch = /^\/api\/sessions\/([^/]+)\/discard$/.exec(url.pathname)
        if (discardMatch) {
          const response = sessionActionResponse(
            discardSession(discardMatch[1]!, resolveDb(url)),
          )
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
