import { useSessionLog } from "@/hooks/useSessionLog"
import { eventLabel, eventClass, metaSummary } from "@/lib/format"
import { focusSession } from "@/api/client"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

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
  const [project, ...rest] = sessionName.split("/")
  const session = rest.join("/")
  const { data: events } = useSessionLog(project!, session!, true)

  const filtered = (events ?? [])
    .filter((e) => e.Event !== "context.snapshot")
    .slice(-50)

  function handleFocus(e: React.MouseEvent) {
    e.stopPropagation()
    void focusSession(project!, session!)
  }

  return (
    <div className="max-h-[400px] overflow-y-auto px-3 pb-2 pt-1 text-xs">
      {filtered.length === 0 ? (
        <span className="text-muted-foreground">no log entries</span>
      ) : (
        <>
          {filtered.map((e, i) => {
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
                key={i}
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
          })}
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              className={buttonVariants({ variant: "outline", size: "xs" })}
              onClick={handleFocus}
            >
              focus
            </button>
          </div>
        </>
      )}
    </div>
  )
}
