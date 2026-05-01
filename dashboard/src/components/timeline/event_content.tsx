import type { EventRow } from "../../api/types";
import { categoryOf } from "../../lib/timeline/categories";
import { InteractionContent } from "./interaction_content";
import { MilestoneContent } from "./milestone_content";
import { WorkContent } from "./work_content";

type EventContentProps = {
  event: EventRow;
};

export function EventContent({ event }: EventContentProps) {
  const category = categoryOf(event.event);

  switch (category) {
    case "interaction":
      return <InteractionContent event={event} />;
    case "work":
      return <WorkContent event={event} />;
    case "milestone":
      return <MilestoneContent event={event} />;
    default:
      return null;
  }
}
EventContent.displayName = "EventContent";
