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

  return (
    <>
      <Header count={sorted.length} activeCount={activeCount} />
      <div className="p-2">
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            no sessions
          </div>
        ) : (
          <Accordion>
            {sorted.map((s) => (
              <SessionCard key={s.session} session={s} />
            ))}
          </Accordion>
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
