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

export type EditEntry = { oldStr: string; newStr: string }

export type PermissionDetail = {
  tool: string
  detail: string
  outcome: string
  oldStr?: string
  newStr?: string
  edits?: EditEntry[]
}

function asEdits(p: PermissionDetail): EditEntry[] {
  if (p.edits && p.edits.length > 0) return p.edits
  if (p.oldStr || p.newStr) {
    return [{ oldStr: p.oldStr ?? "", newStr: p.newStr ?? "" }]
  }
  return []
}

// permission.request / permission.resolve events carry only {tool, detail, outcome}.
// Diff data lives on tool.applied events (camelCase) and is read directly by
// consolidateToolApplied, never via this helper.
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
 * Diff data captured at resolve time is forwarded via meta.permissions[].oldStr/newStr.
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

    // Extract permission details from requests. Resolves carry no extra payload
    // beyond outcome=approved (diffs live on tool.applied), so we just need the
    // requests and the presence/absence of paired resolves.
    const requests = batch.filter((e) => e.event === "permission.request")

    // Orphan resolves with no matching request — drop the batch entirely.
    // These can occur from stale /tmp markers or partial event-write failures.
    if (requests.length === 0) continue

    const permissions: PermissionDetail[] = requests.map(extractPermissionDetail)

    // Check if there's a resolve for each request (batch has both)
    const hasResolves = batch.some((e) => e.event === "permission.resolve")

    // Deduplicate identical tool+detail pairs, adding counts and accumulating diffs
    const dedupMap = new Map<string, PermissionDetail & { count: number }>()
    for (const p of permissions) {
      const key = `${p.tool}::${p.detail}`
      const existing = dedupMap.get(key)
      if (existing) {
        existing.count++
        const merged = [...asEdits(existing), ...asEdits(p)]
        if (merged.length > 0) {
          existing.edits = merged
          existing.oldStr = undefined
          existing.newStr = undefined
        }
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

const TOOL_APPLIED_TITLES: Record<string, string> = {
  Edit: "edited a file",
  Write: "wrote a file",
  MultiEdit: "edited a file",
}

/**
 * Merge runs of consecutive tool.applied events into a single event whose
 * meta.permissions[] aggregates per-file diffs from each run member. Any non-
 * tool.applied event (turn boundaries like session.answered/user.prompt, or
 * tool.work cards) breaks the run, mirroring consolidatePermissions.
 */
export const consolidateToolApplied: TimelineTransform = (events) => {
  const result: EventRow[] = []
  let i = 0

  while (i < events.length) {
    const ev = events[i]

    if (ev.event !== "tool.applied") {
      result.push(ev)
      i++
      continue
    }

    const batch: EventRow[] = []
    while (i < events.length && events[i].event === "tool.applied") {
      batch.push(events[i])
      i++
    }

    if (batch.length === 1) {
      result.push(batch[0])
      continue
    }

    const collected: PermissionDetail[] = []
    for (const e of batch) {
      const meta = e.meta as Record<string, unknown> | null
      const perms = meta?.permissions
      if (Array.isArray(perms)) {
        for (const p of perms as PermissionDetail[]) collected.push(p)
      }
    }

    const dedupMap = new Map<string, PermissionDetail & { count: number }>()
    for (const p of collected) {
      const key = `${p.tool}::${p.detail}`
      const existing = dedupMap.get(key)
      const incoming = (p as PermissionDetail & { count?: number }).count ?? 1
      if (existing) {
        existing.count += incoming
        const merged = [...asEdits(existing), ...asEdits(p)]
        if (merged.length > 0) {
          existing.edits = merged
          existing.oldStr = undefined
          existing.newStr = undefined
        }
      } else {
        dedupMap.set(key, { ...p, count: incoming })
      }
    }
    const deduped = [...dedupMap.values()]

    const last = batch[batch.length - 1]
    result.push({
      ...last,
      meta: { ...(last.meta as Record<string, unknown> | null), permissions: deduped },
    })
  }

  return result
}

/**
 * Set summary on tool.applied events if missing. The hook passes --summary, but older
 * compiled binaries silently ignore it; this transform fills the gap based on meta.
 * For consolidated runs, summarize as "edited N files".
 */
export const decorateToolApplied: TimelineTransform = (events) =>
  events.map((e) => {
    if (e.event !== "tool.applied" || e.summary) return e
    const meta = e.meta as Record<string, unknown> | null
    const permissions = (meta?.permissions ?? []) as Array<{ tool?: string }>
    if (permissions.length > 1) {
      return { ...e, summary: `edited ${permissions.length} files` }
    }
    const tool = permissions[0]?.tool
    if (!tool) return e
    return { ...e, summary: TOOL_APPLIED_TITLES[tool] ?? `${tool} applied` }
  })

/**
 * Lifecycle events (claude.started/ended/discarded) only carry claude_id; the
 * model surfaces on context.snapshot. Pull the nearest snapshot's model onto
 * each lifecycle event in the same conversation so renderers can show it.
 */
export const decorateLifecycleModel: TimelineTransform = (events) => {
  const lifecycleTypes = new Set(["claude.started", "claude.ended", "claude.discarded"])
  return events.map((e, i) => {
    if (!lifecycleTypes.has(e.event)) return e
    const meta = e.meta as Record<string, unknown> | null
    if (meta?.model) return e

    const cid = (meta?.claude_id as string | undefined) ?? e.conversationId
    if (!cid) return e

    // claude.started → look forward for first snapshot; ended/discarded → look back
    const forward = e.event === "claude.started"
    const range = forward
      ? events.slice(i + 1)
      : events.slice(0, i).reverse()

    for (const candidate of range) {
      if (candidate.event !== "context.snapshot") continue
      const cMeta = candidate.meta as Record<string, unknown> | null
      const cCid = (cMeta?.claude_id as string | undefined) ?? candidate.conversationId
      if (cCid !== cid) continue
      const model = cMeta?.model as string | undefined
      if (!model) continue
      return { ...e, meta: { ...meta, model } }
    }
    return e
  })
}

const transforms: TimelineTransform[] = [
  consolidateLifecycle,
  consolidateInteractions,
  consolidatePermissions,
  consolidateToolApplied,
  decorateToolApplied,
  decorateLifecycleModel,
]

export function applyTransforms(events: EventRow[]): EventRow[] {
  return transforms.reduce((acc, fn) => fn(acc), events)
}
