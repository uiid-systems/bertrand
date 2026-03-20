import { useSessionStore } from "@/store/session-store"
import type { SessionStatus } from "@/lib/types"

const STATUSES: { status: SessionStatus; label: string }[] = [
  { status: "working", label: "working" },
  { status: "blocked", label: "blocked" },
  { status: "prompting", label: "prompting" },
  { status: "paused", label: "paused" },
  { status: "archived", label: "archived" },
]

const chipColors: Record<SessionStatus, { active: string; inactive: string }> = {
  working: {
    active: "bg-[var(--status-working)]/15 text-[var(--status-working)] ring-[var(--status-working)]/30",
    inactive: "text-muted-foreground hover:text-[var(--status-working)]",
  },
  blocked: {
    active: "bg-[var(--status-blocked)]/15 text-[var(--status-blocked)] ring-[var(--status-blocked)]/30",
    inactive: "text-muted-foreground hover:text-[var(--status-blocked)]",
  },
  prompting: {
    active: "bg-[var(--status-prompting)]/15 text-[var(--status-prompting)] ring-[var(--status-prompting)]/30",
    inactive: "text-muted-foreground hover:text-[var(--status-prompting)]",
  },
  paused: {
    active: "bg-muted-foreground/15 text-muted-foreground ring-muted-foreground/30",
    inactive: "text-muted-foreground/60 hover:text-muted-foreground",
  },
  archived: {
    active: "bg-muted-foreground/10 text-muted-foreground/80 ring-muted-foreground/20",
    inactive: "text-muted-foreground/40 hover:text-muted-foreground/60",
  },
}

export function StatusChips({ counts }: { counts: Record<SessionStatus, number> }) {
  const statusFilters = useSessionStore((s) => s.statusFilters)
  const toggleStatusFilter = useSessionStore((s) => s.toggleStatusFilter)
  const clearStatusFilters = useSessionStore((s) => s.clearStatusFilters)
  const hasFilters = statusFilters.size > 0

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={clearStatusFilters}
        className={`rounded px-2 py-0.5 text-xs transition-colors ${
          !hasFilters
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        all
      </button>
      {STATUSES.map(({ status, label }) => {
        const isActive = statusFilters.has(status)
        const colors = chipColors[status]
        const count = counts[status]

        return (
          <button
            key={status}
            onClick={() => toggleStatusFilter(status)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              isActive
                ? `${colors.active} ring-1`
                : colors.inactive
            }`}
          >
            {label}
            {count > 0 && (
              <span className="ml-1 text-[10px] opacity-60">{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
