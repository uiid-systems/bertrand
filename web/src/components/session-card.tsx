import type { Session, SessionStatus } from "@/lib/types"
import { formatAgo } from "@/lib/format"
import { parseSessionName } from "@/lib/sessions"
import { focusSession } from "@/api/client"
import { StatusDot } from "@/components/status-dot"
import { LogDrawer } from "@/components/log-drawer"
import { Checkbox } from "@/components/checkbox"
import { Button } from "@/components/ui/button"
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"

const badgeColors: Record<SessionStatus, string> = {
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
  const parsed = parseSessionName(session.session)
  const name = parsed.session
  const ago = formatAgo(session.timestamp)
  const hasSummary =
    session.summary && session.summary !== "Session " + session.status

  function handleFocus(e: React.MouseEvent) {
    e.stopPropagation()
    focusSession(session.session)
  }

  return (
    <AccordionItem value={session.session}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 items-center gap-2.5">
          {onSelect && (
            <Checkbox
              checked={!!selected}
              onChange={(checked) => onSelect(session.session, checked)}
              label={`Select session ${name}`}
            />
          )}
          <StatusDot status={session.status} />
          <div className="min-w-0 flex-1 truncate font-semibold">
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
