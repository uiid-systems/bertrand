import { useSessionLog } from "@/hooks/useSessionLog"
import { SessionStats } from "@/components/session-stats"
import {
  TimelineSegmentView,
  buildSegments,
  extractRepoBase,
} from "@/components/timeline-event"
import { Separator } from "@/components/ui/separator"
import { useMemo, useRef, useEffect } from "react"

/**
 * Format a date as a short label for day separators.
 * Today → "Today", Yesterday → "Yesterday", else → "Mar 20"
 */
function dayLabel(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = today.getTime() - target.getTime()
  if (diff === 0) return "Today"
  if (diff === 86400000) return "Yesterday"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function dayKey(ts: string): string {
  return new Date(ts).toDateString()
}

export function LogDrawer({ sessionName }: { sessionName: string }) {
  const { data: digest, isError } = useSessionLog(sessionName, true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const timeline = digest?.timeline ?? []
  const segments = useMemo(() => buildSegments(timeline.slice(-50)), [timeline])
  const repoBase = useMemo(() => extractRepoBase(timeline), [timeline])

  // Auto-scroll to bottom when segments change
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [segments])

  if (isError) {
    return (
      <div className="px-3 pb-2 pt-1 text-xs">
        <span className="text-destructive">failed to load log</span>
      </div>
    )
  }

  if (!digest || timeline.length === 0) {
    return (
      <div className="px-3 pb-2 pt-1 text-xs">
        <span className="text-muted-foreground">no log entries</span>
      </div>
    )
  }

  // Track which days we've seen to insert separators
  let lastDay = ""

  return (
    <div className="text-xs">
      <SessionStats digest={digest} />
      <Separator />
      <div
        ref={scrollRef}
        className="max-h-[250px] @sm:max-h-[400px] overflow-y-auto px-3 pb-2 pt-1.5"
      >
        {segments.map((seg, i) => {
          const segDay = dayKey(seg.ts)
          const showSeparator = segDay !== lastDay && lastDay !== ""
          lastDay = segDay

          return (
            <div key={`${seg.ts}-${seg.type}-${i}`}>
              {showSeparator && (
                <div className="flex items-center gap-2 py-1.5 opacity-40">
                  <div className="flex-1 border-t border-muted-foreground/20" />
                  <span className="text-[10px] text-muted-foreground">
                    {dayLabel(new Date(seg.ts))}
                  </span>
                  <div className="flex-1 border-t border-muted-foreground/20" />
                </div>
              )}
              <TimelineSegmentView segment={seg} repoBase={repoBase} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
