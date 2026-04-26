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

const transforms: TimelineTransform[] = [consolidateLifecycle, consolidateInteractions]

export function applyTransforms(events: EventRow[]): EventRow[] {
  return transforms.reduce((acc, fn) => fn(acc), events)
}
