import { useState, useMemo, useEffect } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQueryState, parseAsStringLiteral } from "nuqs"
import { useSessions } from "@/hooks/useSessions"
import { useBulkArchive, useBulkDelete } from "@/hooks/useSessionMutations"
import { useSessionStore } from "@/store/session-store"
import { SessionCard } from "@/components/session-card"
import { Checkbox } from "@/components/checkbox"
import { Accordion } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select"
import { parseSessionName } from "@/lib/sessions"
import type { Session, SessionStatus } from "@/lib/types"

export const Route = createFileRoute("/")({
  component: Dashboard,
})

const FILTER_TABS = ["live", "paused", "archived", "all"] as const
type FilterTab = (typeof FILTER_TABS)[number]

const STATUS_ORDER: Record<SessionStatus, number> = {
  blocked: 0,
  prompting: 1,
  working: 2,
  paused: 3,
  archived: 4,
}

function isLive(status: SessionStatus) {
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
  const { data: sessions, isLoading, isError } = useSessions()
  const bulkArchive = useBulkArchive()
  const bulkDelete = useBulkDelete()
  const busy = bulkArchive.isPending || bulkDelete.isPending

  const selectedProject = useSessionStore((s) => s.selectedProject)
  const setSelectedProject = useSessionStore((s) => s.setSelectedProject)

  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(FILTER_TABS).withDefault("live"),
  )
  function changeTab(t: FilterTab) {
    setTab(t)
    setSelected(new Set())
    setConfirming(null)
  }
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null)

  const allSessions = sessions ?? []

  /** Distinct project names derived from session data */
  const projects = useMemo(() => {
    const set = new Set<string>()
    for (const s of allSessions) {
      set.add(parseSessionName(s.session).project)
    }
    return Array.from(set).sort()
  }, [allSessions])

  // Auto-select first project if none selected or current selection no longer exists
  useEffect(() => {
    if (projects.length > 0 && (!selectedProject || !projects.includes(selectedProject))) {
      setSelectedProject(projects[0]!)
    }
  }, [projects, selectedProject, setSelectedProject])

  /** Sessions filtered to the active project */
  const all = useMemo(
    () =>
      selectedProject
        ? allSessions.filter(
            (s) => parseSessionName(s.session).project === selectedProject,
          )
        : allSessions,
    [allSessions, selectedProject],
  )

  const counts = useMemo(() => {
    const c = { live: 0, paused: 0, archived: 0, all: 0 }
    for (const s of all) {
      if (isLive(s.status)) c.live++
      else if (s.status === "paused") c.paused++
      else if (s.status === "archived") c.archived++
      c.all++
    }
    return c as Record<FilterTab, number>
  }, [all])

  const sorted = useMemo(
    () => sortSessions(filterSessions(all, tab)),
    [all, tab],
  )

  const grouped = useMemo(() => groupSessions(sorted), [sorted])

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

  function handleBulkAction(action: "archive" | "delete") {
    const mutation = action === "archive" ? bulkArchive : bulkDelete
    mutation.mutate(selectedInView, {
      onSuccess: () => {
        setSelected(new Set())
        setConfirming(null)
      },
    })
  }

  if (isLoading || isError) {
    return (
      <>
        <Header
          projects={projects}
          selectedProject={selectedProject}
          onProject={setSelectedProject}
          counts={counts}
          tab={tab}
          onTab={changeTab}
        />
        <div className="p-10 text-center text-muted-foreground">
          {isError ? (
            <span className="text-destructive">failed to load sessions</span>
          ) : (
            "loading..."
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <Header
        projects={projects}
        selectedProject={selectedProject}
        onProject={setSelectedProject}
        counts={counts}
        tab={tab}
        onTab={changeTab}
      />

      {showBulk && sorted.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-1.5">
          <Checkbox
            checked={selectedInView.length === sorted.length && sorted.length > 0}
            onChange={() => handleSelectAll()}
            label="Select all sessions"
          />
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
  projects,
  selectedProject,
  onProject,
  counts,
  tab,
  onTab,
}: {
  projects: string[]
  selectedProject: string | null
  onProject: (project: string | null) => void
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
      <Select
        value={selectedProject ?? ""}
        onValueChange={(val) => onProject(val || null)}
      >
        <SelectTrigger size="sm" className="min-w-0 w-auto border-none shadow-none bg-transparent font-semibold text-sm">
          <SelectValue placeholder="project" />
        </SelectTrigger>
        <SelectPopup>
          {projects.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
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
