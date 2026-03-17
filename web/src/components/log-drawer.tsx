import { useSessionLog } from "@/hooks/useSessionLog"
import { eventLabel, eventClass, metaSummary } from "@/lib/format"
import { cn } from "@/lib/utils"

const eventColorClasses: Record<string, string> = {
  started: "text-[var(--status-working)]",
  resumed: "text-[var(--status-working)]",
  blocked: "text-[var(--status-blocked)]",
  ended: "text-muted-foreground",
  permission: "text-destructive",
  pr: "text-primary",
  linear: "text-chart-4",
}

export function LogDrawer({ sessionName }: { sessionName: string }) {
  const { data: events, isError } = useSessionLog(sessionName, true)

  const filtered = (events ?? [])
    .filter((e) => e.Event !== "context.snapshot")
    .slice(-50)

  return (
    <div className="max-h-[400px] overflow-y-auto px-3 pb-2 pt-1 text-xs">
      {isError ? (
        <span className="text-destructive">failed to load log</span>
      ) : filtered.length === 0 ? (
        <span className="text-muted-foreground">no log entries</span>
      ) : (
        filtered.map((e) => {
          const ts = new Date(e.TS).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
          const label = eventLabel(e.Event)
          const cls = eventClass(e.Event)
          const detail = metaSummary(e.TypedMeta)

          return (
            <div
              key={`${e.TS}-${e.Event}`}
              className="flex gap-2 py-0.5 text-muted-foreground"
            >
              <span className="w-10 shrink-0">{ts}</span>
              <span
                className={cn("w-24 shrink-0", eventColorClasses[cls])}
              >
                {label}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {detail}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}
