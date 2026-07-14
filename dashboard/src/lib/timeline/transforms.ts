import type { EventRow } from "../../api/types"
import { labelOf } from "./categories"

export type TimelineTransform = (events: EventRow[]) => EventRow[]

/**
 * Drop events the catalog doesn't know about. Historical DBs carry rows for
 * events that have since been removed (permission.request, session.paused,
 * session.started, gh.pr.*, etc.) — without this filter they'd render as
 * "unknown" placeholders in the timeline.
 */
export const filterUnknown: TimelineTransform = (events) =>
  events.filter((e) => labelOf(e.event) !== "unknown")

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
      const next = events[i + 1]
      if (next && next.event === "session.answered") {
        const question = (curr.meta as Record<string, unknown> | null)?.question
        result.push({
          ...next,
          meta: { ...next.meta, question },
        })
        // Mark both waiting and answered as consumed
        skip.add(i)
        skip.add(i + 1)
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

// tool.used events carry {tool, detail, outcome}. Diff data lives on
// tool.applied events (camelCase) and is read directly by
// consolidateToolApplied, never via this helper.
function extractPermissionDetail(event: EventRow): PermissionDetail {
  const meta = event.meta as Record<string, unknown> | null
  return {
    tool: (meta?.tool as string) ?? "unknown",
    detail: (meta?.detail as string) ?? "",
    outcome: (meta?.outcome as string) ?? "auto",
  }
}

// Past-tense verb per tool — used to compose descriptive single-call titles
// ("read foo.ts") and grouped-call summaries ("read 3 files"). Tools not in
// the map fall back to the bare tool name.
const TOOL_VERBS: Record<string, string> = {
  Bash: "ran",
  Edit: "edited",
  MultiEdit: "edited",
  Write: "wrote",
  Read: "read",
  Glob: "globbed",
  Grep: "grepped",
  WebFetch: "fetched",
  WebSearch: "searched",
  TodoWrite: "updated todos",
}

// Noun used when summarizing N+ calls of one tool ("ran 14 commands").
const TOOL_NOUNS: Record<string, string> = {
  Bash: "commands",
  Edit: "files",
  MultiEdit: "files",
  Write: "files",
  Read: "files",
  Glob: "patterns",
  Grep: "patterns",
  WebFetch: "urls",
  WebSearch: "queries",
}

const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "Read"])

function basenameOf(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

function formatSinglePermission(p: PermissionDetail): string {
  const verb = TOOL_VERBS[p.tool] ?? p.tool

  if (!p.detail) return verb

  if (p.tool === "Bash") {
    return `ran \`${truncate(p.detail, 60)}\``
  }

  if (FILE_TOOLS.has(p.tool)) {
    return `${verb} ${basenameOf(p.detail)}`
  }

  return `${verb} ${truncate(p.detail, 60)}`
}

function formatGroupedToolSummary(
  counts: Iterable<[string, number]>,
): string {
  const parts: string[] = []
  for (const [tool, count] of counts) {
    const verb = TOOL_VERBS[tool] ?? tool
    if (count === 1) {
      // Single call — just the verb (the detail is per-permission and
      // doesn't roll up usefully into a mixed-tool summary).
      parts.push(verb)
    } else {
      const noun = TOOL_NOUNS[tool] ?? "calls"
      parts.push(`${verb} ${count} ${noun}`)
    }
  }
  return parts.join(", ")
}

const ROLLUP_EVENTS = new Set(["tool.used"])

/**
 * Collapse runs of consecutive tool.used events into summarized tool.work
 * events. Single calls get a descriptive title; batches get a tool-count
 * summary with individual details in meta.permissions.
 *
 * tool.used covers every tool call — outcome:"auto" for auto-approved and
 * outcome:"approved" for prompted-then-approved.
 */
export const consolidatePermissions: TimelineTransform = (events) => {
  const result: EventRow[] = []
  let i = 0

  while (i < events.length) {
    const ev = events[i]

    if (!ROLLUP_EVENTS.has(ev.event)) {
      result.push(ev)
      i++
      continue
    }

    const batch: EventRow[] = []
    while (i < events.length) {
      const current = events[i]
      if (!ROLLUP_EVENTS.has(current.event)) break
      batch.push(current)
      i++
    }

    if (batch.length === 0) continue

    const permissions: PermissionDetail[] = batch.map(extractPermissionDetail)
    const hasApproved = permissions.some((p) => p.outcome === "approved")

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
        meta: { ...batch[batch.length - 1].meta, permissions: deduped, outcome: hasApproved ? "approved" : "auto" },
      })
    } else {
      // Multiple unique permissions — count summary with deduplicated details
      const toolCounts = new Map<string, number>()
      for (const p of deduped) {
        toolCounts.set(p.tool, (toolCounts.get(p.tool) ?? 0) + p.count)
      }
      const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
      const summary = formatGroupedToolSummary(sorted)

      // Use midpoint timestamp
      const firstTs = new Date(batch[0].createdAt).getTime()
      const lastTs = new Date(batch[batch.length - 1].createdAt).getTime()

      result.push({
        ...batch[0],
        event: "tool.work",
        summary,
        meta: { permissions: deduped, outcome: hasApproved ? "approved" : "auto" },
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
 * The events that make up one agent turn: the agent's prose replies and the
 * tool work it does between two human touch-points. Everything else
 * (user.prompt, session.answered/waiting, claude.started/ended) is a boundary
 * that breaks a run.
 */
const AGENT_TURN_EVENTS = new Set([
  "assistant.message",
  "tool.work",
  "tool.applied",
])

/**
 * Fold each run of consecutive agent events into a single `agent.turn` card so
 * the timeline reads as an even back-and-forth: one human card, one "Agent's
 * response" card, repeat. The run's members are preserved verbatim in
 * `meta.parts` (already summarized/consolidated by the transforms above) and
 * rendered in order inside the one card, so the sequence reads exactly as it
 * did when each was its own card — just without the per-part rail markers and
 * time badges that made a busy turn explode into dozens of rows.
 *
 * Runs of length 1 are left untouched: a lone reply or tool call is already a
 * single card and gains nothing from being wrapped.
 *
 * Runs cannot cross a conversation boundary because transforms run per segment.
 */
export const consolidateAgentTurns: TimelineTransform = (events) => {
  const result: EventRow[] = []
  let i = 0

  while (i < events.length) {
    const ev = events[i]

    if (!AGENT_TURN_EVENTS.has(ev.event)) {
      result.push(ev)
      i++
      continue
    }

    const batch: EventRow[] = []
    while (i < events.length && AGENT_TURN_EVENTS.has(events[i].event)) {
      batch.push(events[i])
      i++
    }

    if (batch.length === 1) {
      result.push(batch[0])
      continue
    }

    // Keep the first member's id/createdAt so the card's anchor is stable and
    // its time badge marks when the turn began.
    result.push({
      ...batch[0],
      event: "agent.turn",
      summary: null,
      meta: { parts: batch },
    })
  }

  return result
}

const transforms: TimelineTransform[] = [
  filterUnknown,
  consolidateInteractions,
  consolidatePermissions,
  consolidateToolApplied,
  decorateToolApplied,
  consolidateAgentTurns,
]

export function applyTransforms(events: EventRow[]): EventRow[] {
  return transforms.reduce((acc, fn) => fn(acc), events)
}
