import { MessageQuestionIcon } from "@hugeicons/core-free-icons";

import { Text } from "@uiid/design-system";

import { TimelineSegment } from "./timeline-event";
import { getMeta } from "./utils";
import { Row } from "./row";
import { SegmentWrapper } from "./subcomponents/segment-wrapper";

type QASegmentProps = {
  segment: TimelineSegment;
};

export function QASegment({ segment }: QASegmentProps) {
  const block = segment.events[0];
  const resume = segment.events.find((e) => e.event === "session.resume");
  const m = getMeta(block);
  const question = m.question || block.summary || "Waiting for input";
  const answer = resume ? getMeta(resume).answer || resume.summary : null;

  return (
    <Row
      ts={segment.ts}
      icon={MessageQuestionIcon}
      iconColor="text-(--event-orange)"
    >
      <SegmentWrapper className="border-(--event-orange)!">
        <Text size={-1}>{question}</Text>
        {answer ? (
          <Text size={-1} shade="muted" className="italic">
            {answer}
          </Text>
        ) : resume ? (
          <Text size={-1} shade="halftone" className="italic" mt={1}>
            response not captured
          </Text>
        ) : null}
      </SegmentWrapper>
    </Row>
  );
}
