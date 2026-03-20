import { useSessionLog } from "@/hooks/useSessionLog"
import { SessionStats } from "@/components/session-stats"
import {
  TimelineSegmentView,
  buildSegments,
  extractRepoBase,
} from "@/components/timeline-event"
import { Separator } from "@/components/ui/separator"
import { useMemo } from "react"

export function LogDrawer({ sessionName }: { sessionName: string }) {
  const { data: digest, isError } = useSessionLog(sessionName, true)

  const timeline = digest?.timeline ?? []
  const segments = useMemo(() => buildSegments(timeline.slice(-50)), [timeline])
  const repoBase = useMemo(() => extractRepoBase(timeline), [timeline])

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

  return (
    <div className="text-xs">
      <SessionStats digest={digest} />
      <Separator />
      <div className="max-h-[250px] @sm:max-h-[400px] overflow-y-auto px-3 pb-2 pt-1.5">
        {segments.map((seg, i) => (
          <TimelineSegmentView
            key={`${seg.ts}-${seg.type}-${i}`}
            segment={seg}
            repoBase={repoBase}
          />
        ))}
      </div>
    </div>
  )
}
