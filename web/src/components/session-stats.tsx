import type { SessionDigest } from "@/lib/types"
import { formatDurationS } from "@/lib/format"

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <span>
      <span className="text-foreground font-medium">{value}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

function Dot() {
  return <span className="text-muted-foreground/30 hidden @sm:inline">&middot;</span>
}

export function SessionStats({ digest }: { digest: SessionDigest }) {
  const duration = formatDurationS(digest.duration_s)
  const activePct = digest.timing?.active_pct ?? 0

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-[11px]">
      <Stat value={duration} label="duration" />
      <Dot />
      <Stat value={`${activePct}%`} label="active" />
      {digest.conversations > 0 && (
        <>
          <Dot />
          <span className="hidden @sm:inline">
            <Stat
              value={digest.conversations}
              label={digest.conversations === 1 ? "conversation" : "conversations"}
            />
          </span>
        </>
      )}
      {digest.interactions > 0 && (
        <>
          <Dot />
          <Stat
            value={digest.interactions}
            label={digest.interactions === 1 ? "interaction" : "interactions"}
          />
        </>
      )}
      {digest.prs > 0 && (
        <>
          <Dot />
          <Stat value={digest.prs} label={digest.prs === 1 ? "PR" : "PRs"} />
        </>
      )}
    </div>
  )
}
