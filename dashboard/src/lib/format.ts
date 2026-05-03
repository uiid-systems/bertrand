import type { EventRow, SessionRow } from "../api/types"
import { colorOf, labelOf } from "./timeline/categories"

type SessionStatus = SessionRow["status"]

const PALETTE_BY_STATUS = {
  active: "green",
  waiting: "yellow",
  paused: "neutral",
  archived: "neutral",
} as const

export function statusColor(status: SessionStatus) {
  return PALETTE_BY_STATUS[status]
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return "0s"

  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function modelLabel(model: string | undefined): string | undefined {
  if (!model) return undefined
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "")
}

export function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000

  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`

  return new Date(iso).toLocaleDateString()
}

export const eventColor = colorOf

export const eventLabel = labelOf

export function eventTitle(event: EventRow): string {
  const label = eventLabel(event.event)
  const meta = event.meta as Record<string, unknown> | null

  if (!meta) return label

  switch (event.event) {
    case "session.answered": {
      const question = meta.question as string | undefined
      return question ?? label
    }
    case "tool.work":
      return event.summary ?? label
    case "context.snapshot": {
      const pct = meta.remaining_pct as string | undefined
      return pct ? `${pct}% remaining` : label
    }
    default:
      return label
  }
}

export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}
