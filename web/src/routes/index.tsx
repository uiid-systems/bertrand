import { useState, useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSessions } from "@/hooks/useSessions"
import { useBulkArchive, useBulkDelete } from "@/hooks/useSessionMutations"
import { useSessionStore } from "@/store/session-store"
import type { ViewMode } from "@/store/session-store"
import { SessionCard } from "@/components/session-card"
import { SearchInput } from "@/components/search-input"
import { StatusChips } from "@/components/status-chips"
import { ViewSwitcher } from "@/components/view-switcher"
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

const STATUS_ORDER: Record<SessionStatus, number> = {
  blocked: 0,
  prompting: 1,
  working: 2,
  paused: 3,
  archived: 4,
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  blocked: "blocked",
  prompting: "prompting",
  working: "working",
  paused: "paused",
  archived: "archived",
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 2
    const ob = STATUS_ORDER[b.status] ?? 2
    if (oa !== ob) return oa - ob
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

function sortByTime(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )
}

/** Group sessions by ticket. Sessions without a ticket land in "direct". */
function groupByTicket(sessions: Session[]) {
  const tickets = new Map<string, Session[]>()
  const direct: Session[] = []

  for (const s of sessions) {
    const { ticket } = parseSessionName(s.session)
    if (ticket) {
      if (!tickets.has(ticket)) tickets.set(ticket, [])
      tickets.get(ticket)!.push(s)
    } else {
      direct.push(s)
    }
  }

  return { tickets, direct }
}

/** Group sessions by status. */
function groupByStatus(sessions: Session[]) {
  const groups = new Map<SessionStatus, Session[]>()

  for (const s of sessions) {
    if (!groups.has(s.status)) groups.set(s.status, [])
    groups.get(s.status)!.push(s)
  }

  // Sort groups by status order
  const sorted = new Map(
    [...groups.entries()].sort(
      ([a], [b]) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99),
    ),
  )

  return sorted
}

function matchesSearch(session: Session, query: string): boolean {
  const q = query.toLowerCase()
  return (
    session.session.toLowerCase().includes(q) ||
    session.summary.toLowerCase().includes(q)
  )
}

function Dashboard() {
  const { data: sessions, isLoading, isError } = useSessions()
  const bulkArchive = useBulkArchive()
  const bulkDelete = useBulkDelete()
  const busy = bulkArchive.isPending || bulkDelete.isPending

  const selectedProject = useSessionStore((s) => s.selectedProject)
  const setSelectedProject = useSessionStore((s) => s.setSelectedProject)
  const searchQuery = useSessionStore((s) => s.searchQuery)
  const statusFilters = useSessionStore((s) => s.statusFilters)
  const viewMode = useSessionStore((s) => s.viewMode)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(null)

  const allSessions = sessions ?? []

  /** Parse once, derive everything from the result */
  const parsed = useMemo(
    () => allSessions.map((s) => ({ session: s, parsed: parseSessionName(s.session) })),
    [allSessions],
  )

  /** Distinct project names derived from session data */
  const projects = useMemo(() => {
    const set = new Set<string>()
    for (const { parsed: p } of parsed) set.add(p.project)
    return Array.from(set).sort()
  }, [parsed])

  /** Fall back to first project if selection is stale or empty */
  const effectiveProject =
    selectedProject && projects.includes(selectedProject)
      ? selectedProject
      : projects[0] ?? null

  /** Sessions filtered to the active project */
  const projectFiltered = useMemo(
    () =>
      effectiveProject
        ? parsed.filter((e) => e.parsed.project === effectiveProject).map((e) => e.session)
        : allSessions,
    [parsed, effectiveProject, allSessions],
  )

  /** Per-status counts (before search/status filtering, but after project filter) */
  const statusCounts = useMemo(() => {
    const c: Record<SessionStatus, number> = {
      working: 0,
      blocked: 0,
      prompting: 0,
      paused: 0,
      archived: 0,
    }
    for (const s of projectFiltered) c[s.status]++
    return c
  }, [projectFiltered])

  /** Apply status filters */
  const statusFiltered = useMemo(
    () =>
      statusFilters.size > 0
        ? projectFiltered.filter((s) => statusFilters.has(s.status))
        : projectFiltered,
    [projectFiltered, statusFilters],
  )

  /** Apply search filter */
  const searchFiltered = useMemo(
    () =>
      searchQuery.trim()
        ? statusFiltered.filter((s) => matchesSearch(s, searchQuery.trim()))
        : statusFiltered,
    [statusFiltered, searchQuery],
  )

  /** Sort based on view mode */
  const sorted = useMemo(
    () => (viewMode === "recent" ? sortByTime(searchFiltered) : sortSessions(searchFiltered)),
    [searchFiltered, viewMode],
  )

  // Bulk actions available when filtering to non-live statuses
  const hasOnlyBulkable =
    statusFilters.size > 0 &&
    [...statusFilters].every((s) => s === "paused" || s === "archived")
  const showBulk = hasOnlyBulkable
  const canArchive = statusFilters.has("paused") && !statusFilters.has("archived")
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
          selectedProject={effectiveProject}
          onProject={setSelectedProject}
          statusCounts={statusCounts}
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
        statusCounts={statusCounts}
      />

      {showBulk && sorted.length > 0 && (
        <div className="flex items-center gap-1.5 @sm:gap-2 border-b border-border px-3 @sm:px-4 py-1.5">
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
              {canArchive && (
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
            {searchQuery.trim() ? "no matching sessions" : "no sessions"}
          </div>
        ) : (
          <SessionList
            sessions={sorted}
            viewMode={viewMode}
            selected={selected}
            onSelect={showBulk ? handleSelect : undefined}
          />
        )}
      </div>
    </>
  )
}

function SessionList({
  sessions,
  viewMode,
  selected,
  onSelect,
}: {
  sessions: Session[]
  viewMode: ViewMode
  selected: Set<string>
  onSelect?: (name: string, checked: boolean) => void
}) {
  if (viewMode === "recent") {
    return (
      <Accordion>
        {sessions.map((s) => (
          <SessionCard
            key={s.session}
            session={s}
            selected={selected.has(s.session)}
            onSelect={onSelect}
          />
        ))}
      </Accordion>
    )
  }

  if (viewMode === "status") {
    const groups = groupByStatus(sessions)
    return (
      <>
        {Array.from(groups.entries()).map(([status, statusSessions]) => (
          <div key={status} className="mb-2">
            <h3 className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 mt-2 mb-1 text-xs font-semibold text-muted-foreground">
              {STATUS_LABELS[status]}
              <span className="inline-flex items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none">{statusSessions.length}</span>
            </h3>
            <Accordion>
              {statusSessions.map((s) => (
                <SessionCard
                  key={s.session}
                  session={s}
                  selected={selected.has(s.session)}
                  onSelect={onSelect}
                />
              ))}
            </Accordion>
          </div>
        ))}
      </>
    )
  }

  // viewMode === "ticket"
  const { tickets, direct } = groupByTicket(sessions)
  return (
    <>
      {Array.from(tickets.entries()).map(([ticket, ticketSessions]) => (
        <div key={ticket} className="mb-2">
          <h3 className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-1.5 mt-2 mb-1 text-xs font-semibold text-muted-foreground">
            {ticket}/
          </h3>
          <Accordion>
            {ticketSessions.map((s) => (
              <SessionCard
                key={s.session}
                session={s}
                selected={selected.has(s.session)}
                onSelect={onSelect}
              />
            ))}
          </Accordion>
        </div>
      ))}
      {direct.length > 0 && (
        <Accordion>
          {direct.map((s) => (
            <SessionCard
              key={s.session}
              session={s}
              selected={selected.has(s.session)}
              onSelect={onSelect}
            />
          ))}
        </Accordion>
      )}
    </>
  )
}

function Header({
  projects,
  selectedProject,
  onProject,
  statusCounts,
}: {
  projects: string[]
  selectedProject: string | null
  onProject: (project: string | null) => void
  statusCounts: Record<SessionStatus, number>
}) {
  return (
    <div className="border-b border-border">
      <div className="flex flex-col @sm:flex-row @sm:items-center justify-between gap-2 px-3 @sm:px-4 py-2 @sm:py-3">
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
        <div className="w-48">
          <SearchInput />
        </div>
      </div>
      <div className="flex items-center justify-between px-3 @sm:px-4 pb-2">
        <StatusChips counts={statusCounts} />
        <ViewSwitcher />
      </div>
    </div>
  )
}
