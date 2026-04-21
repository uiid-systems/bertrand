import { useState, useEffect } from "react"

type Session = {
  session: {
    id: string
    slug: string
    name: string
    status: string
    startedAt: string
    endedAt: string | null
  }
  groupPath: string
}

type Event = {
  id: number
  sessionId: string
  conversationId: string | null
  event: string
  summary: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(setSessions)
  }, [])

  useEffect(() => {
    if (!selectedSessionId) {
      setEvents([])
      return
    }
    fetch(`/api/events/${selectedSessionId}`)
      .then((r) => r.json())
      .then(setEvents)
  }, [selectedSessionId])

  return (
    <div style={{ fontFamily: "monospace", padding: 24 }}>
      <h1 style={{ fontSize: 16, marginBottom: 16 }}>bertrand</h1>

      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ width: 300, flexShrink: 0 }}>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>Sessions</h2>
          {sessions.map((s) => (
            <button
              key={s.session.id}
              onClick={() => setSelectedSessionId(s.session.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                marginBottom: 4,
                border: "1px solid",
                borderColor: selectedSessionId === s.session.id ? "#fff" : "#333",
                background: selectedSessionId === s.session.id ? "#222" : "transparent",
                color: "inherit",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              <div>{s.groupPath}/{s.session.slug}</div>
              <div style={{ fontSize: 11, opacity: 0.6 }}>{s.session.status}</div>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: 14, marginBottom: 8 }}>
            Events{selectedSessionId ? ` (${events.length})` : ""}
          </h2>
          {!selectedSessionId && (
            <div style={{ opacity: 0.5 }}>Select a session</div>
          )}
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
      </div>
    </div>
  )
}
