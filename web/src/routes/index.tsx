import { createFileRoute } from "@tanstack/react-router"
import { useSessions } from "@/hooks/useSessions"
import { SessionCard } from "@/components/session-card"
import { Accordion } from "@/components/ui/accordion"
import type { Session } from "@/lib/types"

export const Route = createFileRoute("/")({
  component: Dashboard,
})

const STATUS_ORDER: Record<string, number> = {
  blocked: 0,
  working: 1,
  done: 2,
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 1
    const ob = STATUS_ORDER[b.status] ?? 1
    if (oa !== ob) return oa - ob
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

/** Parse a session name into { project, ticket, session } */
function parseSessionName(name: string) {
  const parts = name.split("/")
  if (parts.length === 3) {
    return { project: parts[0], ticket: parts[1], session: parts[2] }
  }
  return { project: parts[0], ticket: "", session: parts.slice(1).join("/") }
}

/** Group sessions by project, then by ticket within each project */
function groupSessions(sessions: Session[]) {
  const projects = new Map<
    string,
    { tickets: Map<string, Session[]>; direct: Session[] }
  >()

  for (const s of sessions) {
    const { project, ticket } = parseSessionName(s.session)
    if (!projects.has(project)) {
      projects.set(project, { tickets: new Map(), direct: [] })
    }
    const group = projects.get(project)!
    if (ticket) {
      if (!group.tickets.has(ticket)) {
        group.tickets.set(ticket, [])
      }
      group.tickets.get(ticket)!.push(s)
    } else {
      group.direct.push(s)
    }
  }

  return projects
}

function Dashboard() {
  const { data: sessions, isLoading } = useSessions()

  if (isLoading) {
    return (
      <>
        <Header count={0} activeCount={0} />
        <div className="p-10 text-center text-muted-foreground">
          loading...
        </div>
      </>
    )
  }

  const sorted = sortSessions(sessions ?? [])
  const activeCount = sorted.filter((s) => s.status !== "done").length
  const grouped = groupSessions(sorted)

  return (
    <>
      <Header count={sorted.length} activeCount={activeCount} />
      <div className="p-2">
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            no sessions
          </div>
        ) : (
          Array.from(grouped.entries()).map(([project, group]) => (
            <div key={project} className="mb-4">
              <h2 className="px-3 py-1 text-xs font-semibold text-muted-foreground">
                {project}/
              </h2>
              {Array.from(group.tickets.entries()).map(
                ([ticket, ticketSessions]) => (
                  <div key={ticket} className="ml-2">
                    <h3 className="px-3 py-0.5 text-xs text-muted-foreground">
                      {ticket}/
                    </h3>
                    <Accordion>
                      {ticketSessions.map((s) => (
                        <SessionCard key={s.session} session={s} />
                      ))}
                    </Accordion>
                  </div>
                ),
              )}
              {group.direct.length > 0 && (
                <Accordion>
                  {group.direct.map((s) => (
                    <SessionCard key={s.session} session={s} />
                  ))}
                </Accordion>
              )}
            </div>
          ))
        )}
      </div>
    </>
  )
}

function Header({
  count,
  activeCount,
}: {
  count: number
  activeCount: number
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <h1 className="text-sm font-semibold">bertrand</h1>
      {count > 0 && (
        <span className="text-xs text-muted-foreground">
          {count} sessions{activeCount > 0 && `, ${activeCount} active`}
        </span>
      )}
    </div>
  )
}
