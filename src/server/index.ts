import { execFile } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { tryUpgradeTerminal, terminalWebSocketHandlers } from "./terminal-relay"
import {
  DashboardSessionLimitError,
  spawnDashboardSession,
  resumeDashboardSession,
  stopDashboardSession,
} from "@/engine/dashboard-session"
import { recoverStaleSessions } from "@/engine/recovery"
import { type ChangedFile } from "@/lib/git"
import {
  getAllSessionsForProject,
  getSession,
  countLiveSessions,
} from "@/db/queries/sessions"
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
import {
  rateSession,
  discardSession,
  type RateResult,
  type DiscardResult,
} from "@/lib/session-actions"
import {
  listProjects,
  setActiveProjectSlug,
  projectExists,
  getProjectRepo,
  type ProjectRepo,
} from "@/lib/projects/registry"
import { formatIdentity } from "@/lib/github/identity"
import { isDeclaredHost } from "@/lib/github/hosts"
import { getPRForBranch } from "@/lib/github/pr"
import { resolveRepoAt } from "@/lib/github/resolve"
import { resolveSessionPullRequest } from "@/lib/github/session-pr"
import {
  resolveActiveProject,
  _resetActiveProjectCache,
} from "@/lib/projects/resolve"
import { UnboundProjectError } from "@/lib/projects/policy"
import { isValidSlug } from "@/lib/projects/paths"
import { getDbForProject, invalidateDbCache, closeDbForProject, type Db } from "@/db/client"
import type {
  SessionRow,
  SessionWithCategory,
  EventRow,
  SessionStatsRow,
  EngagementStats,
  ProjectRepoView,
  ProjectSummary,
  ActiveProjectMeta,
  SessionPullRequest,
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
 * Overlay a stored git snapshot's diff counters onto a freshly computed row.
 *
 * `liveStats` walks events, so its diff counters measure what the agent typed.
 * Once a git snapshot exists it is the better answer — the branch's net change,
 * matching the changed-files list beside it — and it is the one that will
 * outlive the worktree that produced it. Only the three counters move;
 * everything else on a live row is event-derived and current by construction.
 *
 * The writer is gone with the worktree teardown, but this reader stays: rows
 * already stamped `diff_source = 'git'` keep their branch-accurate numbers,
 * exactly like the retained `worktree.entered` / `worktree.exited` events.
 */
function withStoredGitDiffs(row: SessionStatsRow, db?: Db): SessionStatsRow {
  const stored = getSessionStats(row.sessionId, db)
  if (stored?.diffSource !== "git") return row
  return {
    ...row,
    linesAdded: stored.linesAdded,
    linesRemoved: stored.linesRemoved,
    filesTouched: stored.filesTouched,
    diffSource: "git",
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

/**
 * The repo root a response's file paths should be rendered relative to.
 *
 * Deliberately mirrors `resolveDb`'s choice of project, so the paths and the
 * rows they describe always come from the same one — reading the active
 * project's root while serving another project's sessions would render every
 * path absolute. `undefined` when that project has no repo bound, which the
 * display path treats as "leave it absolute".
 */
function resolveRepoRoot(url: URL): string | undefined {
  const slug = url.searchParams.get("project")
  const owner = slug && projectExists(slug) ? slug : resolveActiveProject().slug
  return getProjectRepo(owner)?.path
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
        result[session.id] = withStoredGitDiffs(liveStats(session.id, db), db)
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
  if (isLive) return withStoredGitDiffs(liveStats(sessionId!, db), db)
  return getSessionStats(sessionId!, db) ?? backfilledStats(sessionId!, db)
}

// /api/stats/:sessionId/files — the individual files a session changed, with
// per-file line counts, replayed from the session's own timeline. Covers every
// session uniformly now that worktrees are gone. A missing session answers
// "nothing changed" so the sidebar can poll quietly.
const getChangedFilesBySession = (
  { sessionId }: { sessionId?: string },
  url: URL,
): Promise<ChangedFile[]> => {
  const db = resolveDb(url)
  const session = getSession(sessionId!, db)
  if (!session) return Promise.resolve([])
  return resolveChangedFiles(session, resolveRepoRoot(url), db)
}

const getEngagement = (
  { sessionId }: { sessionId?: string },
  url: URL,
): EngagementStats => computeEngagementStats(sessionId!, resolveDb(url))

/** Widen a stored binding into its wire form, or `null` when unbound. */
const toRepoView = (repo: ProjectRepo | undefined): ProjectRepoView | null =>
  repo
    ? {
        ...repo,
        label: formatIdentity(repo.provider),
        hostTrusted: isDeclaredHost(repo.provider.host),
      }
    : null

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
const getSessionPullRequest = (
  { sessionId }: { sessionId?: string },
  url: URL,
): Promise<SessionPullRequest> => {
  const session = getSession(sessionId!, resolveDb(url))
  if (!session) return Promise.resolve({ status: "none" })
  return resolveSessionPullRequest(
    {
      // Nothing records a branch per session yet (ELKY-177), so this is null
      // for every session and the card stays dark.
      branch: null,
      repoPath: resolveRepoRoot(url),
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
 * Release the DB handles this process holds for a project the CLI just removed
 * (issue #249). Closing them is what actually returns the disk space after a
 * `--purge`: the unlinked inodes survive as long as any descriptor is open.
 *
 * Gated on the project being absent from the registry, which is both the
 * correctness argument and the safety one. `project remove` writes the registry
 * before calling here, so a live project reaching this path means the caller is
 * confused (or malicious — the API is loopback-only but unauthenticated), and
 * closing a DB still being served would break in-flight dashboard reads. A 409
 * says so rather than silently doing nothing.
 *
 * The slug shape is checked for the same reason: it becomes a filesystem path
 * on the way to a cache key, so `a/../b` would normalize onto project `b` and
 * close a live project's connection despite the registry check above passing
 * for the literal string.
 */
function handleEvictProject(slug: string): Response {
  if (!isValidSlug(slug)) {
    return Response.json(
      { error: `Invalid project slug "${slug}"`, reason: "invalid-slug" },
      { status: 400 },
    )
  }
  if (projectExists(slug)) {
    return Response.json(
      {
        error: `Project "${slug}" is still registered — remove it before evicting`,
        reason: "still-registered",
      },
      { status: 409 },
    )
  }
  return Response.json({ ok: true, slug, closed: closeDbForProject(slug) })
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
  // Legacy rows only: worktrees are gone (ELKY-163), so this session predates
  // the teardown and its recorded directory is not the one it worked in.
  // Deliberately silent on whether that worktree still exists — the guard fires
  // either way, and half these rows point at a directory already deleted.
  "worktree-gone": {
    status: 409,
    message:
      "This session worked in a worktree, which bertrand no longer manages. " +
      "The directory on record is not the one it worked in, so resuming here " +
      "would put its work on the wrong branch. Resume it from the CLI, in the " +
      "directory that work belongs to.",
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
 * Spawn a session whose PTY this server owns (issue #207). Unlike a
 * CLI-started session there is no terminal involved at all — the browser that
 * attaches becomes the sole sizing authority.
 *
 * The body carries no path. Where the session works is derived from the active
 * project's repo binding, because a client-supplied path is both untrustworthy
 * (any directory on the machine) and unnecessary (the project already knows).
 * Every dashboard session gets its own worktree under that repo's main
 * checkout (#210), and the worktree is the working directory.
 */
async function handleSpawnDashboardSession(req: Request): Promise<Response> {
  let body: {
    categoryPath?: unknown
    slug?: unknown
    name?: unknown
    baseBranch?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { categoryPath, slug } = body
  if (typeof categoryPath !== "string" || !categoryPath) {
    return Response.json({ error: "categoryPath must be a non-empty string" }, { status: 400 })
  }
  if (typeof slug !== "string" || !slug) {
    return Response.json({ error: "slug must be a non-empty string" }, { status: 400 })
  }

  try {
    const result = await spawnDashboardSession({
      categoryPath,
      slug,
      name: typeof body.name === "string" ? body.name : undefined,
    })
    return Response.json(result)
  } catch (err) {
    // The project this server is pointed at has no directory bound at all, so
    // there is nowhere to start. 409 rather than 500: nothing is broken, a
    // prerequisite is simply missing, and `err.message` already names the
    // command that fixes it. `reason` lets a UI offer the link action inline
    // instead of printing a sentence about the CLI. Note the binding need not
    // be a git repo — bertrand logs sessions outside version control too.
    if (err instanceof UnboundProjectError) {
      return Response.json(
        { error: err.message, reason: "unbound-project", slug: err.slug },
        { status: 409 },
      )
    }
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

      // Drop a removed project's cached DB handles so its files are released
      // (see handler).
      if (req.method === "POST") {
        const evictMatch = /^\/api\/projects\/([^/]+)\/evict$/.exec(url.pathname)
        if (evictMatch) {
          const r = handleEvictProject(decodeURIComponent(evictMatch[1]!))
          r.headers.set("Access-Control-Allow-Origin", "*")
          return r
        }
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
