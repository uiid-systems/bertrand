import { createRootRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { sessionsQuery } from "../api/queries"

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { data: sessions = [] } = useQuery(sessionsQuery)
  const matchRoute = useMatchRoute()

  return (
    <div style={{ fontFamily: "monospace", padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 16 }}>bertrand</h1>

      <div style={{ display: "flex", gap: 24 }}>
        <nav style={{ width: 280, flexShrink: 0 }}>
          <h2 style={{ fontSize: 13, marginBottom: 8, opacity: 0.6 }}>
            Sessions ({sessions.length})
          </h2>
          {sessions.map((s) => {
            const isActive = matchRoute({
              to: "/sessions/$sessionId",
              params: { sessionId: s.session.id },
            })
            return (
              <Link
                key={s.session.id}
                to="/sessions/$sessionId"
                params={{ sessionId: s.session.id }}
                style={{
                  display: "block",
                  padding: "8px 12px",
                  marginBottom: 4,
                  border: "1px solid",
                  borderColor: isActive ? "#fff" : "#333",
                  background: isActive ? "#222" : "transparent",
                  color: "inherit",
                  textDecoration: "none",
                  fontSize: 13,
                }}
              >
                <div>{s.groupPath}/{s.session.slug}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>{s.session.status}</div>
              </Link>
            )
          })}
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
