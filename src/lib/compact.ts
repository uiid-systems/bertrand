import type { EnrichedEvent } from "./catalog.ts";
import { lookup } from "./catalog.ts";

/**
 * Stage 1: Relocate session.resume events to sit immediately after their matching session.block.
 * Matches by claudeId. If already adjacent, no change.
 */
export function repairQAPairs(events: EnrichedEvent[]): EnrichedEvent[] {
  const result = [...events];

  for (let i = 0; i < result.length; i++) {
    const ev = result[i]!;
    if (ev.event !== "session.resume") continue;

    // Find the closest preceding session.block with matching claudeId
    let blockIdx = -1;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = result[j]!;
      if (candidate.event === "session.block" && candidate.claudeId === ev.claudeId) {
        blockIdx = j;
        break;
      }
    }

    if (blockIdx === -1) continue; // No matching block found
    if (blockIdx === i - 1) continue; // Already adjacent

    // Remove resume from current position and insert after block
    result.splice(i, 1);
    result.splice(blockIdx + 1, 0, ev);
  }

  return result;
}

/**
 * Stage 2: Collapse sequences of permission.request + permission.resolve into
 * summarized "tool.work" events. E.g. "8× Bash, 2× Edit".
 */
export function collapsePermissions(events: EnrichedEvent[]): EnrichedEvent[] {
  const result: EnrichedEvent[] = [];
  let i = 0;

  while (i < events.length) {
    const ev = events[i]!;

    if (ev.event !== "permission.request" && ev.event !== "permission.resolve") {
      result.push(ev);
      i++;
      continue;
    }

    // Collect consecutive permission events
    const batch: EnrichedEvent[] = [];
    while (i < events.length) {
      const current = events[i]!;
      if (current.event !== "permission.request" && current.event !== "permission.resolve") break;
      batch.push(current);
      i++;
    }

    if (batch.length === 0) continue;

    // Count tools
    const toolCounts = new Map<string, number>();
    for (const pev of batch) {
      const meta = pev.meta as Record<string, unknown> | null;
      const tool = (meta?.tool as string) ?? "unknown";
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    }

    // Build summary
    const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
    const summary =
      batch.length === 1
        ? formatSinglePermission(batch[0]!)
        : sorted.map(([tool, count]) => `${count}× ${tool}`).join(", ");

    // Use midpoint timestamp
    const first = batch[0]!;
    const last = batch[batch.length - 1]!;
    const midMs =
      (new Date(first.createdAt).getTime() + new Date(last.createdAt).getTime()) / 2;

    result.push({
      ...first,
      event: "tool.work",
      label: "tool work",
      category: "work",
      summary,
      createdAt: new Date(midMs).toISOString(),
    });
  }

  return result;
}

function formatSinglePermission(ev: EnrichedEvent): string {
  const meta = ev.meta as Record<string, unknown> | null;
  const tool = (meta?.tool as string) ?? "";
  const detail = (meta?.detail as string) ?? "";

  if (!detail) return tool;

  switch (tool) {
    case "Bash":
      return `ran \`${detail}\``;
    case "Edit":
    case "Write":
      return `${tool.toLowerCase()} ${detail}`;
    default:
      return `${tool}: ${detail}`;
  }
}

/**
 * Stage 3: Collapse consecutive identical events into a single event (keep latest timestamp).
 */
export function deduplicate(events: EnrichedEvent[]): EnrichedEvent[] {
  if (events.length === 0) return [];

  const result: EnrichedEvent[] = [events[0]!];

  for (let i = 1; i < events.length; i++) {
    const current = events[i]!;
    const prev = result[result.length - 1]!;

    if (current.event === prev.event && current.summary === prev.summary) {
      // Replace previous with current (later timestamp)
      result[result.length - 1] = current;
    } else {
      result.push(current);
    }
  }

  return result;
}

/**
 * Filter out events marked with skip=true in the catalog.
 */
export function filterSkipped(events: EnrichedEvent[]): EnrichedEvent[] {
  return events.filter((ev) => !lookup(ev.event).skip);
}

/**
 * Full compaction pipeline: skip → Q&A repair → permission collapse → dedup.
 */
export function compact(events: EnrichedEvent[]): EnrichedEvent[] {
  return deduplicate(collapsePermissions(repairQAPairs(filterSkipped(events))));
}
