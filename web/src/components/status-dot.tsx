import type { SessionStatus } from "@/lib/types"

const statusColors: Record<SessionStatus, string> = {
  working: "bg-[var(--status-working)]",
  blocked: "bg-[var(--status-blocked)] animate-pulse",
  prompting: "bg-[var(--status-prompting)]",
  paused: "bg-[var(--status-paused)]",
  archived: "bg-[var(--status-archived)]",
}

export function StatusDot({ status }: { status: SessionStatus }) {
  return (
    <div
      className={`h-2 w-2 shrink-0 rounded-full ${statusColors[status]}`}
    />
  )
}
