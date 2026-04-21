import { createFileRoute, Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { sessionsQuery } from "../api/queries"

export const Route = createFileRoute("/")({
  component: SessionList,
})

function SessionList() {
  const { data: sessions = [] } = useQuery(sessionsQuery)

  return (
    <div>
      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Sessions</h2>
      {sessions.map((s) => (
        <Link
          key={s.session.id}
          to="/sessions/$sessionId"
          params={{ sessionId: s.session.id }}
          style={{
            display: "block",
            padding: "8px 12px",
            marginBottom: 4,
            border: "1px solid #333",
            color: "inherit",
            textDecoration: "none",
            fontFamily: "monospace",
            fontSize: 13,
          }}
        >
          <div>{s.groupPath}/{s.session.slug}</div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>{s.session.status}</div>
        </Link>
      ))}
    </div>
  )
}
