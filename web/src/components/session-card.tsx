import type { Session } from "@/lib/types"
import { formatAgo } from "@/lib/format"
import { focusSession } from "@/api/client"
import { StatusDot } from "@/components/status-dot"
import { LogDrawer } from "@/components/log-drawer"
import { Button } from "@/components/ui/button"
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"

const badgeColors: Record<string, string> = {
  working: "bg-[var(--status-working)]/15 text-[var(--status-working)]",
  blocked: "bg-[var(--status-blocked)]/15 text-[var(--status-blocked)]",
  prompting: "bg-[var(--status-prompting)]/15 text-[var(--status-prompting)]",
  paused: "bg-muted-foreground/15 text-muted-foreground",
  archived: "bg-muted-foreground/10 text-muted-foreground/60",
}

export function SessionCard({
  session,
  selected,
  onSelect,
}: {
  session: Session
  selected?: boolean
  onSelect?: (name: string, checked: boolean) => void
}) {
  const parts = session.session.split("/")
  const project = parts[0]
  const name = parts.slice(1).join("/")
  const ago = formatAgo(session.timestamp)
  const hasSummary =
    session.summary && session.summary !== "Session " + session.status

  function handleFocus(e: React.MouseEvent) {
    e.stopPropagation()
    focusSession(session.session)
  }

  function handleCheck(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    onSelect?.(session.session, !selected)
  }

  return (
    <AccordionItem value={session.session}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 items-center gap-2.5">
          {onSelect && (
            <div
              role="checkbox"
              aria-checked={!!selected}
              tabIndex={0}
              onClick={handleCheck}
              onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); handleCheck(e) } }}
              className={`flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border ${
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40"
              }`}
            >
              {selected && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          )}
          <StatusDot status={session.status} />
          <div className="min-w-0 flex-1 truncate font-semibold">
            <span className="font-normal text-muted-foreground">
              {project}/
            </span>
            {name}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            <Button
              variant="ghost"
              size="xs"
              onClick={handleFocus}
            >
              focus
            </Button>
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
