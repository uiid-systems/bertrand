import type { Session } from "@/lib/types"
import { formatAgo } from "@/lib/format"
import { StatusDot } from "@/components/status-dot"
import { LogDrawer } from "@/components/log-drawer"
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"

const badgeColors: Record<string, string> = {
  working: "bg-[var(--status-working)]/15 text-[var(--status-working)]",
  blocked: "bg-[var(--status-blocked)]/15 text-[var(--status-blocked)]",
  done: "bg-muted-foreground/15 text-muted-foreground",
}

export function SessionCard({ session }: { session: Session }) {
  const parts = session.session.split("/")
  const project = parts[0]
  const name = parts.slice(1).join("/")
  const ago = formatAgo(session.timestamp)
  const hasSummary =
    session.summary && session.summary !== "Session " + session.status

  return (
    <AccordionItem value={session.session}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 items-center gap-2.5">
          <StatusDot status={session.status} />
          <div className="min-w-0 flex-1 truncate font-semibold">
            <span className="font-normal text-muted-foreground">
              {project}/
            </span>
            {name}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeColors[session.status]}`}
            >
              {session.status}
            </span>
            <span>{ago}</span>
          </div>
        </div>
      </AccordionTrigger>
      {hasSummary && (
        <div className="truncate px-3 pb-1 pl-7 text-xs text-muted-foreground">
          {session.summary}
        </div>
      )}
      <AccordionContent>
        <LogDrawer sessionName={session.session} />
      </AccordionContent>
    </AccordionItem>
  )
}
