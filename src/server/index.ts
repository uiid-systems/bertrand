import { getAllSessions, getSession } from "@/db/queries/sessions"
import { getEventsBySession, getEventsByType } from "@/db/queries/events"
import { getSessionStats } from "@/db/queries/stats"
import { computeSessionStats } from "@/lib/timing"
import { computeEngagementStats } from "@/lib/engagement_stats"

const PORT = Number(process.env.BERTRAND_PORT ?? 5200)

type RouteHandler = (params: Record<string, string | undefined>, url: URL) => unknown

const routes: [RegExp, RouteHandler][] = [
  // GET /api/sessions
  [/^\/api\/sessions$/, (_params, url) => {
    const excludeArchived = url.searchParams.get("excludeArchived") !== "false"
    return getAllSessions({ excludeArchived })
  }],

  // GET /api/sessions/:id
  [/^\/api\/sessions\/(?<id>[^/]+)$/, ({ id }) => {
    return getSession(id!)
  }],

  // GET /api/events/:sessionId
  [/^\/api\/events\/(?<sessionId>[^/]+)$/, ({ sessionId }, url) => {
    const eventType = url.searchParams.get("type")
    if (eventType) return getEventsByType(sessionId!, eventType)
    return getEventsBySession(sessionId!)
  }],

  // GET /api/stats/:sessionId
  // Live compute for active/waiting sessions (materialized row would be stale or absent).
  // Paused/archived sessions read the materialized row, falling back to live if missing.
  [/^\/api\/stats\/(?<sessionId>[^/]+)$/, ({ sessionId }) => {
    const session = getSession(sessionId!)
    if (!session) return null
    const isLive = session.status === "active" || session.status === "waiting"
    if (isLive) {
      return { sessionId: sessionId!, ...computeSessionStats(sessionId!), updatedAt: new Date().toISOString() }
    }
    const stored = getSessionStats(sessionId!)
    if (stored) return stored
    return { sessionId: sessionId!, ...computeSessionStats(sessionId!), updatedAt: new Date().toISOString() }
  }],

  // GET /api/engagement/:sessionId
  [/^\/api\/engagement\/(?<sessionId>[^/]+)$/, ({ sessionId }) => {
    return computeEngagementStats(sessionId!)
  }],
]

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

export function startServer(port = PORT) {
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url)

      // CORS for dev
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        })
      }

      const response = match(url.pathname, url)
      response.headers.set("Access-Control-Allow-Origin", "*")
      return response
    },
  })

  console.log(`bertrand API server listening on http://localhost:${server.port}`)
  return server
}
