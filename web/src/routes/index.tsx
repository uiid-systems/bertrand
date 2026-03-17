import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSessions } from "@/hooks/useSessions"
import { SessionCard } from "@/components/session-card"
import { Accordion } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { archiveSession, deleteSession } from "@/api/client"
import type { Session } from "@/lib/types"

export const Route = createFileRoute("/")({
  component: Dashboard,
})

type FilterTab = "live" | "paused" | "archived" | "all"

const STATUS_ORDER: Record<string, number> = {
  blocked: 0,
  prompting: 1,
  working: 2,
  paused: 3,
  archived: 4,
}

function isLive(status: string) {
  return status === "working" || status === "blocked" || status === "prompting"
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 2
    const ob = STATUS_ORDER[b.status] ?? 2
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

function filterSessions(sessions: Session[], tab: FilterTab): Session[] {
  switch (tab) {
    case "live":
      return sessions.filter((s) => isLive(s.status))
    case "paused":
      return sessions.filter((s) => s.status === "paused")
    case "archived":
      return sessions.filter((s) => s.status === "archived")
    case "all":
      return sessions
  }
}

function Dashboard() {
  const { data: sessions, isLoading, refetch } = useSessions()
  const [tab, setTab] = useState<FilterTab>("live")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null)
  const [busy, setBusy] = useState(false)

  const all = sessions ?? []
  const filtered = filterSessions(all, tab)
  const sorted = sortSessions(filtered)
  const grouped = groupSessions(sorted)

  const counts: Record<FilterTab, number> = {
    live: all.filter((s) => isLive(s.status)).length,
    paused: all.filter((s) => s.status === "paused").length,
    archived: all.filter((s) => s.status === "archived").length,
    all: all.length,
  }

  // Only show bulk actions for non-live tabs
  const showBulk = tab !== "live" && tab !== "all"
  const selectedInView = [...selected].filter((n) =>
    sorted.some((s) => s.session === n),
  )

  function handleSelect(name: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
    setConfirming(null)
  }

  function handleSelectAll() {
    if (selectedInView.length === sorted.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sorted.map((s) => s.session)))
    }
    setConfirming(null)
  }

  async function handleBulkAction(action: "archive" | "delete") {
    setBusy(true)
    try {
      const fn = action === "archive" ? archiveSession : deleteSession
      await Promise.all(selectedInView.map((name) => fn(name)))
      setSelected(new Set())
      setConfirming(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <>
        <Header counts={counts} tab={tab} onTab={setTab} />
        <div className="p-10 text-center text-muted-foreground">
          loading...
        </div>
      </>
    )
  }

  return (
    <>
      <Header counts={counts} tab={tab} onTab={setTab} />

      {showBulk && sorted.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
          <div
            onClick={handleSelectAll}
            className={`flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border ${
              selectedInView.length === sorted.length && sorted.length > 0
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/40"
            }`}
          >
            {selectedInView.length === sorted.length && sorted.length > 0 && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {selectedInView.length > 0
              ? `${selectedInView.length} selected`
              : "select all"}
          </span>

          {selectedInView.length > 0 && !confirming && (
            <div className="ml-auto flex gap-1.5">
              {tab === "paused" && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => setConfirming("archive")}
                  disabled={busy}
                >
                  archive
                </Button>
              )}
              <Button
                variant="destructive"
                size="xs"
                onClick={() => setConfirming("delete")}
                disabled={busy}
              >
                delete
              </Button>
            </div>
          )}

          {confirming && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-destructive">
                {confirming} {selectedInView.length} session{selectedInView.length !== 1 ? "s" : ""}?
              </span>
              <Button
                variant="destructive"
                size="xs"
                onClick={() => handleBulkAction(confirming)}
                disabled={busy}
              >
                {busy ? "..." : "confirm"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setConfirming(null)}
                disabled={busy}
              >
                cancel
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="p-2">
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            no {tab === "all" ? "" : tab + " "}sessions
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
                        <SessionCard
                          key={s.session}
                          session={s}
                          selected={selected.has(s.session)}
                          onSelect={showBulk ? handleSelect : undefined}
                        />
                      ))}
                    </Accordion>
                  </div>
                ),
              )}
              {group.direct.length > 0 && (
                <Accordion>
                  {group.direct.map((s) => (
                    <SessionCard
                      key={s.session}
                      session={s}
                      selected={selected.has(s.session)}
                      onSelect={showBulk ? handleSelect : undefined}
                    />
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
  counts,
  tab,
  onTab,
}: {
  counts: Record<FilterTab, number>
  tab: FilterTab
  onTab: (t: FilterTab) => void
}) {
  const tabs: { key: FilterTab; label: string }[] = [
    { key: "live", label: "live" },
    { key: "paused", label: "paused" },
    { key: "archived", label: "archived" },
    { key: "all", label: "all" },
  ]

  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <h1 className="text-sm font-semibold">bertrand</h1>
      <div className="flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onTab(t.key)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              tab === t.key
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className="ml-1 text-[10px] opacity-60">
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
