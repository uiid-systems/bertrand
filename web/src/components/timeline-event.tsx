import type { EnrichedEvent } from "@/lib/types"
import { linearIssueUrl, githubPrUrl } from "@/lib/constants"
import { Badge } from "@/components/ui/badge"
import {
  GitPullRequestIcon,
  GitMergeIcon,
  CodeIcon,
  MessageQuestionIcon,
  GitBranchIcon,
  TaskDaily01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function getMeta(e: EnrichedEvent): Record<string, string> {
  return (e.meta as Record<string, string>) ?? {}
}

/**
 * Strip "AskUserQuestion" from a tool.work summary.
 * e.g. "AskUserQuestion, Edit" → "Edit"
 * e.g. "AskUserQuestion" → ""
 */
function cleanWorkSummary(s: string): string {
  return s
    .split(", ")
    .filter((part) => part !== "AskUserQuestion")
    .join(", ")
}

// ---------------------------------------------------------------------------
// Segment model
// ---------------------------------------------------------------------------

export interface TimelineSegment {
  type: "qa" | "prompt" | "pr" | "linear" | "worktree" | "work" | "lifecycle"
  ts: string
  events: [EnrichedEvent, ...EnrichedEvent[]]
}

const LIFECYCLE = new Set([
  "session.started",
  "session.resumed",
  "session.end",
  "session.paused",
  "claude.started",
  "claude.ended",
  "claude.discarded",
])

/**
 * Collapse a raw timeline into narrative segments.
 *
 * - Pre-filters all permission.request/resolve events (zero information value)
 * - Q&A pairs merge into one segment
 * - Consecutive tool.work collapses, AskUserQuestion stripped
 * - Consecutive linear reads deduplicate
 * - Lifecycle boundaries merge
 */
export function buildSegments(input: EnrichedEvent[]): TimelineSegment[] {
  const raw = input.filter(
    (e) => e.event !== "permission.request" && e.event !== "permission.resolve"
  )

  const out: TimelineSegment[] = []
  let i = 0

  while (i < raw.length) {
    const cur = raw[i]!

    // --- Q&A pair ---
    if (cur.event === "session.block") {
      const pair: [EnrichedEvent, ...EnrichedEvent[]] = [cur]
      let j = i + 1
      while (j < raw.length) {
        const next = raw[j]!
        if (next.event === "session.resume") {
          pair.push(next)
          j++
          break
        }
        if (next.event === "tool.work" && next.summary === "AskUserQuestion") {
          j++
          continue
        }
        break
      }
      out.push({ type: "qa", ts: cur.ts, events: pair })
      i = j
      continue
    }

    // --- User free-text prompt ---
    if (cur.event === "user.prompt") {
      out.push({ type: "prompt", ts: cur.ts, events: [cur] })
      i++
      continue
    }

    // Skip orphan resume
    if (cur.event === "session.resume") {
      i++
      continue
    }

    // --- PR ---
    if (cur.event === "gh.pr.created" || cur.event === "gh.pr.merged") {
      out.push({ type: "pr", ts: cur.ts, events: [cur] })
      i++
      continue
    }

    // --- Linear (collapse consecutive linear reads only) ---
    if (cur.event === "linear.issue.read") {
      const group: [EnrichedEvent, ...EnrichedEvent[]] = [cur]
      let j = i + 1
      while (j < raw.length && raw[j]!.event === "linear.issue.read") {
        group.push(raw[j]!)
        j++
      }
      out.push({ type: "linear", ts: cur.ts, events: group })
      i = j
      continue
    }

    // --- Worktree ---
    if (cur.event === "worktree.entered" || cur.event === "worktree.exited") {
      out.push({ type: "worktree", ts: cur.ts, events: [cur] })
      i++
      continue
    }

    // --- tool.work → collapsed work segment ---
    if (cur.event === "tool.work") {
      const group: EnrichedEvent[] = [cur]
      let j = i + 1
      while (j < raw.length && raw[j]!.event === "tool.work") {
        group.push(raw[j]!)
        j++
      }
      // Filter: keep only tool.work with non-empty cleaned summaries
      const meaningful = group.filter((ev) => cleanWorkSummary(ev.summary).length > 0)
      if (meaningful.length > 0) {
        out.push({
          type: "work",
          ts: cur.ts,
          events: meaningful as [EnrichedEvent, ...EnrichedEvent[]],
        })
      }
      i = j
      continue
    }

    // --- Lifecycle (collapse consecutive) ---
    if (LIFECYCLE.has(cur.event)) {
      const group: [EnrichedEvent, ...EnrichedEvent[]] = [cur]
      let j = i + 1
      while (j < raw.length && LIFECYCLE.has(raw[j]!.event)) {
        group.push(raw[j]!)
        j++
      }
      out.push({ type: "lifecycle", ts: cur.ts, events: group })
      i = j
      continue
    }

    // Fallback
    out.push({ type: "lifecycle", ts: cur.ts, events: [cur] })
    i++
  }

  return out
}

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

function Row({
  ts,
  icon,
  iconColor,
  opacity,
  children,
  pad,
}: {
  ts: string
  icon?: typeof GitPullRequestIcon
  iconColor?: string
  opacity?: string
  children: React.ReactNode
  pad?: boolean
}) {
  return (
    <div className={`flex gap-2 ${pad ? "py-1.5" : "py-0.5"} items-start ${opacity ?? ""}`}>
      <span className="w-10 shrink-0 text-muted-foreground pt-px">
        {formatTime(ts)}
      </span>
      <span className="w-4 shrink-0 flex items-center justify-center pt-px">
        {icon ? (
          <HugeiconsIcon icon={icon} size={12} className={iconColor ?? "text-muted-foreground"} />
        ) : (
          <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
        )}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Segment renderers
// ---------------------------------------------------------------------------

function QASegment({ segment }: { segment: TimelineSegment }) {
  const block = segment.events[0]
  const resume = segment.events.find((e) => e.event === "session.resume")
  const m = getMeta(block)
  const question = m.question || block.summary || "Waiting for input"
  const answer = resume ? getMeta(resume).answer || resume.summary : null

  return (
    <Row ts={segment.ts} icon={MessageQuestionIcon} iconColor="text-[var(--event-orange)]" pad>
      <div className="space-y-1">
        <div className="border-l-2 border-[var(--event-orange)]/50 pl-2.5 text-foreground leading-snug font-sans">
          {question}
        </div>
        {answer ? (
          <div className="pl-3 leading-snug max-w-[75ch] font-sans italic text-muted-foreground">
            {answer}
          </div>
        ) : resume ? (
          <div className="pl-3 text-muted-foreground/40 text-[11px]">
            responded
          </div>
        ) : null}
      </div>
    </Row>
  )
}

function PromptSegment({ segment }: { segment: TimelineSegment }) {
  const e = segment.events[0]
  const m = getMeta(e)
  const prompt = m.prompt || e.summary || ""

  return (
    <Row ts={segment.ts} icon={UserIcon} iconColor="text-[var(--event-blue)]" pad>
      <div className="border-l-2 border-[var(--event-blue)]/50 pl-2.5 text-foreground/80 leading-snug font-sans">
        {prompt}
      </div>
    </Row>
  )
}

function PrSegment({
  segment,
  repoBase,
}: {
  segment: TimelineSegment
  repoBase?: string
}) {
  const e = segment.events[0]
  const m = getMeta(e)
  const isMerged = e.event === "gh.pr.merged"
  const prNum = m.pr_number ? `#${m.pr_number}` : null
  // Use pr_url if available; fall back to repoBase, then constants
  const prUrl =
    m.pr_url ||
    (repoBase && m.pr_number ? `${repoBase}/pull/${m.pr_number}` : null) ||
    (m.pr_number ? githubPrUrl(m.pr_number) : null)
  const icon = isMerged ? GitMergeIcon : GitPullRequestIcon
  const color = isMerged ? "text-[var(--event-purple)]" : "text-[var(--event-green)]"

  return (
    <Row ts={segment.ts} icon={icon} iconColor={color} pad>
      <div className="flex items-center gap-1.5 flex-wrap">
        {prNum && prUrl ? (
          <a href={prUrl} target="_blank" rel="noopener noreferrer">
            <Badge variant="outline" className="gap-1 hover:bg-accent cursor-pointer">
              <HugeiconsIcon icon={icon} size={10} className={color} />
              {prNum}
            </Badge>
          </a>
        ) : prNum ? (
          <Badge variant="outline">{prNum}</Badge>
        ) : null}
        {m.branch && (
          <Badge variant="secondary" className="text-[10px]">
            {m.branch}
          </Badge>
        )}
        <span className="text-foreground text-[11px]">
          {isMerged ? "merged" : "opened"}
        </span>
      </div>
    </Row>
  )
}

function LinearSegment({ segment }: { segment: TimelineSegment }) {
  const seen = new Set<string>()
  const unique = segment.events.filter((e) => {
    const id = getMeta(e).issue_id || e.summary
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })

  // Show issue title only when single issue and title isn't a PR mirror
  const singleTitle =
    unique.length === 1 && unique[0]
      ? getMeta(unique[0]).issue_title
      : undefined
  const showTitle = singleTitle && !/^PR #\d+/.test(singleTitle)

  return (
    <Row ts={segment.ts} icon={TaskDaily01Icon} iconColor="text-[var(--event-purple)]">
      <div className="flex items-center gap-1.5 flex-wrap">
        {unique.map((e, idx) => {
          const m = getMeta(e)
          const id = m.issue_id || e.summary || "issue"
          const url = m.issue_id ? linearIssueUrl(m.issue_id) : null
          return url ? (
            <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
              <Badge
                variant="secondary"
                className="text-[var(--event-purple)] hover:bg-accent cursor-pointer"
              >
                {id}
              </Badge>
            </a>
          ) : (
            <Badge key={idx} variant="secondary" className="text-[var(--event-purple)]">
              {id}
            </Badge>
          )
        })}
        {showTitle && (
          <span className="text-foreground text-[11px] truncate">{singleTitle}</span>
        )}
      </div>
    </Row>
  )
}

function WorktreeSegment({ segment }: { segment: TimelineSegment }) {
  const e = segment.events[0]
  const m = getMeta(e)
  const entered = e.event === "worktree.entered"

  return (
    <Row ts={segment.ts} icon={GitBranchIcon} iconColor="text-[var(--event-green)]" opacity="opacity-80">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-[11px]">
          {entered ? "entered worktree" : "exited worktree"}
        </span>
        {m.branch && (
          <Badge variant="secondary" className="text-[10px]">
            {m.branch}
          </Badge>
        )}
      </div>
    </Row>
  )
}

function WorkSegment({ segment }: { segment: TimelineSegment }) {
  const summaries = segment.events
    .map((e) => cleanWorkSummary(e.summary))
    .filter(Boolean)
  const display =
    summaries.length > 0
      ? summaries.join(", ")
      : `${segment.events.length} tool operations`

  return (
    <Row ts={segment.ts} icon={CodeIcon} opacity="opacity-50">
      <span className="text-muted-foreground text-[11px] truncate block">{display}</span>
    </Row>
  )
}

function LifecycleSegment({ segment }: { segment: TimelineSegment }) {
  const best =
    segment.events.find(
      (e) =>
        e.event === "session.started" ||
        e.event === "session.resumed" ||
        e.event === "session.end"
    ) ?? segment.events[0]

  const label =
    best.event === "session.started"
      ? "session started"
      : best.event === "session.resumed"
        ? "session resumed"
        : best.event === "session.end"
          ? best.summary || "session ended"
          : best.label || best.event

  return (
    <Row ts={segment.ts} opacity="opacity-35">
      <span className="text-muted-foreground text-[11px]">{label}</span>
    </Row>
  )
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/**
 * Extract a GitHub repo base URL from any pr_url in the timeline.
 * e.g. "https://github.com/uiid-systems/bertrand/pull/41" → "https://github.com/uiid-systems/bertrand"
 */
export function extractRepoBase(events: EnrichedEvent[]): string | undefined {
  for (const e of events) {
    const url = getMeta(e).pr_url
    if (url) {
      const match = url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\//)
      if (match?.[1]) return match[1]
    }
  }
  return undefined
}

export function TimelineSegmentView({
  segment,
  repoBase,
}: {
  segment: TimelineSegment
  repoBase?: string
}) {
  switch (segment.type) {
    case "qa":
      return <QASegment segment={segment} />
    case "prompt":
      return <PromptSegment segment={segment} />
    case "pr":
      return <PrSegment segment={segment} repoBase={repoBase} />
    case "linear":
      return <LinearSegment segment={segment} />
    case "worktree":
      return <WorktreeSegment segment={segment} />
    case "work":
      return <WorkSegment segment={segment} />
    case "lifecycle":
      return <LifecycleSegment segment={segment} />
  }
}
