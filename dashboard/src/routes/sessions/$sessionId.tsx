import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { eventsQuery, statsQuery } from "../../api/queries"

export const Route = createFileRoute("/sessions/$sessionId")({
  component: SessionDetail,
})

function SessionDetail() {
  const { sessionId } = Route.useParams()
  const { data: events = [] } = useQuery(eventsQuery(sessionId))
  const { data: stats } = useQuery(statsQuery(sessionId))

  return (
    <div>
      <Link to="/" style={{ color: "inherit", fontSize: 12, opacity: 0.6 }}>
        &larr; back
      </Link>

      {stats && (
        <div style={{ margin: "12px 0", fontSize: 12, opacity: 0.7 }}>
          {stats.eventCount} events &middot; {stats.conversationCount} conversations &middot; {stats.interactionCount} interactions
        </div>
      )}

      <h2 style={{ fontSize: 14, margin: "12px 0 8px" }}>
        Events ({events.length})
      </h2>

      {events.map((e) => (
        <div
          key={e.id}
          style={{
            padding: "8px 12px",
            marginBottom: 4,
            border: "1px solid #333",
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{e.event}</strong>
            <span style={{ opacity: 0.5 }}>{e.createdAt}</span>
          </div>
          {e.summary && <div style={{ marginTop: 4 }}>{e.summary}</div>}
          {e.meta && (
            <pre style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
              {JSON.stringify(e.meta, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
