import type { EventRow } from "../../api/types"

export type TimelineTransform = (events: EventRow[]) => EventRow[]

/** Session lifecycle events redundant with claude lifecycle events. */
const REDUNDANT_SESSION_EVENTS = new Set([
  "session.started",
  "session.resumed",
  "session.end",
])

/**
 * Drop session lifecycle events that duplicate claude lifecycle events.
 * claude.started covers session.started/session.resumed,
 * claude.ended covers session.end.
 */
export const consolidateLifecycle: TimelineTransform = (events) =>
  events.filter((e) => !REDUNDANT_SESSION_EVENTS.has(e.event))

/**
 * Merge adjacent session.waiting + session.answered pairs into a single
 * answered event that carries both the question and the answer.
 * Unpaired waiting events (no answer yet) are left as-is.
 */
export const consolidateInteractions: TimelineTransform = (events) => {
  const result: EventRow[] = []
  const skip = new Set<number>()

  for (let i = 0; i < events.length; i++) {
    if (skip.has(i)) continue
    const curr = events[i]

    if (curr.event === "session.waiting") {
      // Look ahead past context.snapshot to find the matching answered
      let j = i + 1
      while (j < events.length && events[j].event === "context.snapshot") j++

      if (j < events.length && events[j].event === "session.answered") {
        const question = (curr.meta as Record<string, unknown> | null)?.question
        result.push({
          ...events[j],
          meta: { ...events[j].meta, question },
        })
        // Mark waiting, interleaved context snapshots, and answered as consumed
        for (let k = i; k <= j; k++) skip.add(k)
        continue
      }
    }

    result.push(curr)
  }

  return result
}

export type PermissionDetail = {
  tool: string
  detail: string
  outcome: string
}

function extractPermissionDetail(event: EventRow): PermissionDetail {
  const meta = event.meta as Record<string, unknown> | null
  return {
    tool: (meta?.tool as string) ?? "unknown",
    detail: (meta?.detail as string) ?? "",
    outcome: (meta?.outcome as string) ?? (event.event === "permission.resolve" ? "approved" : "pending"),
  }
}

const TOOL_TITLES: Record<string, string> = {
  Bash: "ran a command",
  Edit: "edited a file",
  Write: "wrote a file",
  Read: "read a file",
}

function formatSinglePermission(p: PermissionDetail): string {
  return TOOL_TITLES[p.tool] ?? p.tool
}

/**
 * Collapse consecutive permission.request + permission.resolve pairs into
 * summarized tool.work events. Single pairs get a descriptive title;
 * batches get a tool count summary with individual details in meta.permissions.
 */
export const consolidatePermissions: TimelineTransform = (events) => {
  const result: EventRow[] = []
  let i = 0

  while (i < events.length) {
    const ev = events[i]

    if (ev.event !== "permission.request" && ev.event !== "permission.resolve") {
      result.push(ev)
      i++
      continue
    }

    // Collect consecutive permission events
    const batch: EventRow[] = []
    while (i < events.length) {
      const current = events[i]
      if (current.event !== "permission.request" && current.event !== "permission.resolve") break
      batch.push(current)
      i++
    }

    // Extract permission details (from requests only, to avoid double-counting pairs)
    const permissions: PermissionDetail[] = []
    for (const pev of batch) {
      if (pev.event === "permission.request") {
        permissions.push(extractPermissionDetail(pev))
      }
    }

    // Check if there's a resolve for each request (batch has both)
    const hasResolves = batch.some((e) => e.event === "permission.resolve")

    // Deduplicate identical tool+detail pairs, adding counts
    const dedupMap = new Map<string, PermissionDetail & { count: number }>()
    for (const p of permissions) {
      const key = `${p.tool}::${p.detail}`
      const existing = dedupMap.get(key)
      if (existing) {
        existing.count++
      } else {
        dedupMap.set(key, { ...p, count: 1 })
      }
    }
    const deduped = [...dedupMap.values()]

    if (deduped.length <= 1) {
      // Single unique permission — descriptive title
      const p = deduped[0] ?? extractPermissionDetail(batch[0])
      const summary = formatSinglePermission(p)
      result.push({
        ...batch[batch.length - 1],
        event: "tool.work",
        summary,
        meta: { ...batch[batch.length - 1].meta, permissions: deduped, outcome: hasResolves ? "approved" : "pending" },
      })
    } else {
      // Multiple unique permissions — count summary with deduplicated details
      const toolCounts = new Map<string, number>()
      for (const p of deduped) {
        toolCounts.set(p.tool, (toolCounts.get(p.tool) ?? 0) + p.count)
      }
      const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
      const summary = sorted.map(([tool, count]) => `${count}× ${tool}`).join(", ")

      // Use midpoint timestamp
      const firstTs = new Date(batch[0].createdAt).getTime()
      const lastTs = new Date(batch[batch.length - 1].createdAt).getTime()

      result.push({
        ...batch[0],
        event: "tool.work",
        summary,
        meta: { permissions: deduped, outcome: hasResolves ? "approved" : "pending" },
        createdAt: new Date((firstTs + lastTs) / 2).toISOString(),
      })
    }
  }

  return result
}

const transforms: TimelineTransform[] = [consolidateLifecycle, consolidateInteractions, consolidatePermissions]

export function applyTransforms(events: EventRow[]): EventRow[] {
  return transforms.reduce((acc, fn) => fn(acc), events)
}
