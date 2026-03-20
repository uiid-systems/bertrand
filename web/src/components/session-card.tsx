import type { Session, SessionStatus } from "@/lib/types"
import { formatAgo } from "@/lib/format"
import { parseSessionName } from "@/lib/sessions"
import { focusSession } from "@/api/client"
import { StatusDot } from "@/components/status-dot"
import { LogDrawer } from "@/components/log-drawer"
import { Checkbox } from "@/components/checkbox"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { CenterFocusIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

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

  function handleFocus(e: React.MouseEvent) {
    e.stopPropagation()
    focusSession(session.session)
  }

  return (
    <AccordionItem
      value={session.session}
      className={session.focused ? "ring-1 ring-[var(--status-working)]/30" : undefined}
    >
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 items-center gap-1.5 @sm:gap-2">
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
          <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleFocus}
                    className="hidden @sm:inline-flex"
                  />
                }
              >
                <HugeiconsIcon icon={CenterFocusIcon} size={14} />
              </TooltipTrigger>
              <TooltipContent>Focus session</TooltipContent>
            </Tooltip>
            <span
              className={`hidden @sm:inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeColors[session.status]}`}
            >
              {session.status}
            </span>
            <span className="text-muted-foreground/50">{ago}</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-0 pb-2">
        <LogDrawer sessionName={session.session} />
      </AccordionContent>
    </AccordionItem>
  )
}
