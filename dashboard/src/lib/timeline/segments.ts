import type { EventRow } from "../../api/types"
import { applyTransforms } from "./transforms"

/**
 * One conversation's worth of the session timeline. A bertrand session is a
 * durable unit of work; each conversation is one `claude --session-id` episode
 * within it. Events already carry `conversationId`, so the timeline can be
 * segmented into chapters without any schema or API change.
 *
 * This selector is the shared source of truth: the timeline renders a
 * `<Timeline>` per segment, and the (disposable) conversation dropdown builds
 * its jump list from the same array. A future docs-style rail would subscribe
 * here too — nothing else needs to know how segmentation works.
 */
export type ConversationSegment = {
  /** Grouping key — the conversation UUID, or "unknown" for legacy null rows. */
  conversationId: string
  /** 1-based position in chronological order. Shown as "Conversation N". */
  ordinal: number
  /** Stable DOM anchor, e.g. `conversation-a1b2c3d4`. Deep-linkable via #hash. */
  anchorId: string
  /** First user prompt of the conversation, truncated — the chapter's subject. */
  title: string | null
  /** Timestamp of the first event in the conversation. */
  startedAt: string
  /** Rendered timeline items (transformed per-segment). */
  events: EventRow[]
  /** Count of rendered items — the "N events" in the header. */
  eventCount: number
}

const TITLE_MAX = 80

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max - 1) + "…"
}

function anchorFor(conversationId: string): string {
  const suffix =
    conversationId === "unknown" ? "unknown" : conversationId.slice(0, 8)
  return `conversation-${suffix}`
}

/** First user prompt in a conversation, used as the segment's subtitle. */
function firstPrompt(events: EventRow[]): string | null {
  for (const ev of events) {
    if (ev.event === "user.prompt") {
      const prompt = ev.meta?.prompt
      if (typeof prompt === "string" && prompt.trim()) {
        return truncate(prompt, TITLE_MAX)
      }
    }
  }
  return null
}

/**
 * Group session events into per-conversation segments.
 *
 * Grouping is by `conversationId`. Conversations run strictly sequentially
 * (a session owns one live Claude process at a time), so events already arrive
 * in conversation order. Legacy rows with a null `conversationId` predate
 * conversation tracking — they carry forward into the current segment, or open
 * an "unknown" segment if they lead the timeline.
 *
 * Transforms (tool-call consolidation, Q&A pairing) run *per segment* so a run
 * of tool calls can never be merged across a conversation boundary.
 */
export function segmentConversations(
  rawEvents: EventRow[],
): ConversationSegment[] {
  type Bucket = { conversationId: string; raw: EventRow[] }
  const buckets: Bucket[] = []
  let current: Bucket | null = null

  for (const ev of rawEvents) {
    const key: string = ev.conversationId ?? current?.conversationId ?? "unknown"
    if (!current || current.conversationId !== key) {
      current = { conversationId: key, raw: [] }
      buckets.push(current)
    }
    current.raw.push(ev)
  }

  return buckets.map((bucket, i) => {
    const events = applyTransforms(bucket.raw)
    return {
      conversationId: bucket.conversationId,
      ordinal: i + 1,
      anchorId: anchorFor(bucket.conversationId),
      title: firstPrompt(bucket.raw),
      startedAt: bucket.raw[0]?.createdAt ?? "",
      events,
      eventCount: events.length,
    }
  })
}
