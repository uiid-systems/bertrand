import { UserIcon } from "@hugeicons/core-free-icons";

import { Text } from "@uiid/typography";

import { TimelineSegment } from "./timeline-event";
import { getMeta } from "./utils";
import { Row } from "./row";

import { SegmentWrapper } from "./subcomponents/segment-wrapper";

type PromptSegmentProps = {
  segment: TimelineSegment;
};

export function PromptSegment({ segment }: PromptSegmentProps) {
  const e = segment.events[0];
  const m = getMeta(e);
  const prompt = m.prompt || e.summary || "";

  return (
    <Row
      data-slot="prompt-segment"
      ts={segment.ts}
      icon={UserIcon}
      iconColor="text-(--event-blue)"
    >
      <SegmentWrapper className="border-(--event-blue)!">
        <Text size={-1}>{prompt}</Text>
      </SegmentWrapper>
    </Row>
  );
}
