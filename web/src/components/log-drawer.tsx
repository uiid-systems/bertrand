import { useSessionLog } from "@/hooks/useSessionLog"
import { cn } from "@/lib/utils"

const categoryColors: Record<string, string> = {
  lifecycle: "text-[var(--status-working)]",
  blocked: "text-[var(--status-blocked)]",
  permission: "text-destructive",
  integration: "text-primary",
}

export function LogDrawer({ sessionName }: { sessionName: string }) {
  const { data: digest, isError } = useSessionLog(sessionName, true)

  const timeline = (digest?.timeline ?? []).slice(-50)

  return (
    <div className="max-h-[250px] @sm:max-h-[400px] overflow-y-auto px-3 pb-2 pt-1 text-xs">
      {isError ? (
        <span className="text-destructive">failed to load log</span>
      ) : timeline.length === 0 ? (
        <span className="text-muted-foreground">no log entries</span>
      ) : (
        timeline.map((e, i) => {
          const ts = new Date(e.ts).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })

          return (
            <div
              key={`${e.ts}-${e.event}-${i}`}
              className="flex gap-2 py-0.5 text-muted-foreground"
            >
              <span className="w-10 shrink-0">{ts}</span>
              <span
                className={cn("hidden @sm:inline w-24 shrink-0", categoryColors[e.category])}
              >
                {e.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {e.summary || e.label}
              </span>
            </div>
          )
        })
      )}
    </div>
  )
}
