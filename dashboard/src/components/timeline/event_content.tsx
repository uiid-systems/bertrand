import type { EventRow } from "../../api/types";
import { categoryOf } from "../../lib/timeline/categories";
import { AssistantContent } from "./assistant_content";
import { ContextContent } from "./context_content";
import { InteractionContent } from "./interaction_content";
import { LifecycleContent } from "./lifecycle_content";
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
    case "assistant":
      return <AssistantContent event={event} />;
    case "context":
      return <ContextContent event={event} />;
    case "lifecycle":
      return <LifecycleContent event={event} />;
    default:
      return null;
  }
}
EventContent.displayName = "EventContent";
