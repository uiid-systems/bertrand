import { useSessionStore, type ViewMode } from "@/store/session-store"

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: "status", label: "by status" },
  { mode: "ticket", label: "by ticket" },
  { mode: "recent", label: "recent" },
]

export function ViewSwitcher() {
  const viewMode = useSessionStore((s) => s.viewMode)
  const setViewMode = useSessionStore((s) => s.setViewMode)

  return (
    <div className="flex items-center gap-1">
      {VIEWS.map(({ mode, label }) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            viewMode === mode
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
