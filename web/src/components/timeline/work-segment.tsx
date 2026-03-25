import { CodeIcon } from "@hugeicons/core-free-icons";

import { Text } from "@uiid/typography";

import { TimelineSegment } from "./timeline-event";
import { cleanWorkSummary } from "./utils";
import { Row } from "./row";

import { SegmentWrapper } from "./subcomponents/segment-wrapper";

export function WorkSegment({ segment }: { segment: TimelineSegment }) {
  // Collect all tool names, deduplicate with counts
  const toolCounts = new Map<string, number>();
  for (const e of segment.events) {
    const cleaned = cleanWorkSummary(e.summary);
    if (!cleaned) continue;
    // Split "2× Bash, Edit" into individual tools with counts
    for (const part of cleaned.split(", ")) {
      const countMatch = part.match(/^(\d+)×\s*(.+)$/);
      const name = countMatch?.[2] ?? part;
      const count = countMatch?.[1] ? parseInt(countMatch[1], 10) : 1;
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + count);
    }
  }

  const display =
    toolCounts.size > 0
      ? [...toolCounts.entries()]
          .map(([name, count]) => (count > 1 ? `${count}× ${name}` : name))
          .join(", ")
      : `${segment.events.length} tool operations`;

  return (
    <Row ts={segment.ts} icon={CodeIcon}>
      <SegmentWrapper className="border-muted-foreground!">
        <Text size={-1} shade="halftone">
          {display}
        </Text>
      </SegmentWrapper>
    </Row>
  );
}
