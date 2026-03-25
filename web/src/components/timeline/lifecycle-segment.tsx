import { Text } from "@uiid/typography";

import { Sunrise, Sunset } from "@hugeicons/core-free-icons";

import { TimelineSegment } from "./timeline-event";
import { Row } from "./row";
import { SegmentWrapper } from "./subcomponents/segment-wrapper";

type LifecycleSegmentProps = {
  segment: TimelineSegment;
};

export function LifecycleSegment({ segment }: LifecycleSegmentProps) {
  const best =
    segment.events.find(
      (e) =>
        e.event === "session.started" ||
        e.event === "session.resumed" ||
        e.event === "session.end",
    ) ?? segment.events[0];

  const label =
    best.event === "session.started"
      ? "session started"
      : best.event === "session.resumed"
        ? "session resumed"
        : best.event === "session.end"
          ? best.summary || "session ended"
          : best.label || best.event;

  const icon = best.event === "session.started" ? Sunrise : Sunset;

  return (
    <Row ts={segment.ts} icon={icon} iconColor="text-foreground">
      <SegmentWrapper className="border-foreground!">
        <Text size={-1} shade="halftone">
          {label}
        </Text>
      </SegmentWrapper>
    </Row>
  );
}
