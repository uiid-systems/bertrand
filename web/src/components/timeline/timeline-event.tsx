import type { EnrichedEvent } from "@/lib/types";

import { getMeta } from "./utils";

import { QASegment } from "./qa-segment";
import { PromptSegment } from "./prompt-segment";
import { PrSegment } from "./pr-segment";
import { WorktreeSegment } from "./worktree-segment";
import { WorkSegment } from "./work-segment";
import { LinearSegment } from "./linear-segment";
import { LifecycleSegment } from "./lifecycle-segment";
import { cleanWorkSummary } from "./utils";

// ---------------------------------------------------------------------------
// Segment model
// ---------------------------------------------------------------------------

export interface TimelineSegment {
  type: "qa" | "prompt" | "pr" | "linear" | "worktree" | "work" | "lifecycle";
  ts: string;
  events: [EnrichedEvent, ...EnrichedEvent[]];
}

const LIFECYCLE = new Set([
  "session.started",
  "session.resumed",
  "session.end",
  "session.paused",
  "claude.started",
  "claude.ended",
  "claude.discarded",
]);

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
    (e) => e.event !== "permission.request" && e.event !== "permission.resolve",
  );

  const out: TimelineSegment[] = [];
  let i = 0;

  while (i < raw.length) {
    const cur = raw[i]!;

    // --- Q&A pair ---
    if (cur.event === "session.block") {
      const pair: [EnrichedEvent, ...EnrichedEvent[]] = [cur];
      let j = i + 1;
      while (j < raw.length) {
        const next = raw[j]!;
        if (next.event === "session.resume") {
          pair.push(next);
          j++;
          break;
        }
        if (next.event === "tool.work" && next.summary === "AskUserQuestion") {
          j++;
          continue;
        }
        break;
      }
      out.push({ type: "qa", ts: cur.ts, events: pair });
      i = j;
      continue;
    }

    // --- User free-text prompt ---
    if (cur.event === "user.prompt") {
      out.push({ type: "prompt", ts: cur.ts, events: [cur] });
      i++;
      continue;
    }

    // Skip orphan resume
    if (cur.event === "session.resume") {
      i++;
      continue;
    }

    // --- PR ---
    if (cur.event === "gh.pr.created" || cur.event === "gh.pr.merged") {
      out.push({ type: "pr", ts: cur.ts, events: [cur] });
      i++;
      continue;
    }

    // --- Linear (collapse consecutive linear reads only) ---
    if (cur.event === "linear.issue.read") {
      const group: [EnrichedEvent, ...EnrichedEvent[]] = [cur];
      let j = i + 1;
      while (j < raw.length && raw[j]!.event === "linear.issue.read") {
        group.push(raw[j]!);
        j++;
      }
      out.push({ type: "linear", ts: cur.ts, events: group });
      i = j;
      continue;
    }

    // --- Worktree ---
    if (cur.event === "worktree.entered" || cur.event === "worktree.exited") {
      out.push({ type: "worktree", ts: cur.ts, events: [cur] });
      i++;
      continue;
    }

    // --- tool.work → collapsed work segment ---
    if (cur.event === "tool.work") {
      const group: EnrichedEvent[] = [cur];
      let j = i + 1;
      while (j < raw.length && raw[j]!.event === "tool.work") {
        group.push(raw[j]!);
        j++;
      }
      // Filter: keep only tool.work with non-empty cleaned summaries
      const meaningful = group.filter(
        (ev) => cleanWorkSummary(ev.summary).length > 0,
      );
      if (meaningful.length > 0) {
        out.push({
          type: "work",
          ts: cur.ts,
          events: meaningful as [EnrichedEvent, ...EnrichedEvent[]],
        });
      }
      i = j;
      continue;
    }

    // --- Lifecycle (collapse consecutive) ---
    if (LIFECYCLE.has(cur.event)) {
      const group: [EnrichedEvent, ...EnrichedEvent[]] = [cur];
      let j = i + 1;
      while (j < raw.length && LIFECYCLE.has(raw[j]!.event)) {
        group.push(raw[j]!);
        j++;
      }
      out.push({ type: "lifecycle", ts: cur.ts, events: group });
      i = j;
      continue;
    }

    // Fallback
    out.push({ type: "lifecycle", ts: cur.ts, events: [cur] });
    i++;
  }

  return out;
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
    const url = getMeta(e).pr_url;
    if (url) {
      const match = url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\//);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

export function TimelineSegmentView({
  segment,
  repoBase,
}: {
  segment: TimelineSegment;
  repoBase?: string;
}) {
  switch (segment.type) {
    case "qa":
      return <QASegment segment={segment} />;
    case "prompt":
      return <PromptSegment segment={segment} />;
    case "pr":
      return <PrSegment segment={segment} repoBase={repoBase} />;
    case "linear":
      return <LinearSegment segment={segment} />;
    case "worktree":
      return <WorktreeSegment segment={segment} />;
    case "work":
      return <WorkSegment segment={segment} />;
    case "lifecycle":
      return <LifecycleSegment segment={segment} />;
  }
}
