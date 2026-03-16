import { cn } from "@/lib/utils"
import type { SessionStatus } from "@/lib/types"

const statusColors: Record<SessionStatus, string> = {
  working: "bg-[var(--status-working)]",
  blocked: "bg-[var(--status-blocked)] animate-pulse",
  done: "bg-[var(--status-done)]",
}

export function StatusDot({ status }: { status: SessionStatus }) {
  return (
    <div
      className={cn("h-2 w-2 shrink-0 rounded-full", statusColors[status])}
    />
  )
}
