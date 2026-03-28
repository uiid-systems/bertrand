import { Group, Text } from "@uiid/design-system";

import { TimelineSegment } from "./timeline-event";
import { getMeta } from "./utils";
import { Row } from "./row";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";

import { SegmentWrapper } from "./subcomponents/segment-wrapper";

type WorktreeSegmentProps = {
  segment: TimelineSegment;
};

export function WorktreeSegment({ segment }: WorktreeSegmentProps) {
  const e = segment.events[0];
  const m = getMeta(e);
  const entered = e.event === "worktree.entered";

  return (
    <Row
      data-slot="worktree-segment"
      ts={segment.ts}
      icon={GitBranchIcon}
      iconColor="text-(--event-green)"
    >
      <SegmentWrapper className="border-(--event-green)!">
        <Group gap={2} ay="center">
          <Text size={-1} shade="halftone">
            {entered ? "entered worktree" : "exited worktree"}
          </Text>
          {m.branch && (
            <Badge variant="secondary" className="text-[10px]">
              {m.branch}
            </Badge>
          )}
        </Group>
      </SegmentWrapper>
    </Row>
  );
}
