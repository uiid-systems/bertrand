import type { EventRow } from "../../api/types";
import { categoryOf } from "../../lib/timeline/categories";
import { AgentTurnContent } from "./agent_turn_content";
import { AssistantContent } from "./assistant_content";
import { InteractionContent } from "./interaction_content";
import { LifecycleContent } from "./lifecycle_content";
import { WorkDetail } from "./work_content";

type EventContentProps = Readonly<{
  event: EventRow;
}>;

export function EventContent({ event }: EventContentProps) {
  const category = categoryOf(event.event);

  switch (category) {
    case "interaction":
      return <InteractionContent event={event} />;
    case "work":
      // Body only: a work card's title *is* its disclosure trigger, so the
      // summary must not repeat itself as a line underneath.
      return <WorkDetail event={event} />;
    case "assistant":
      // A consolidated run renders its parts in sequence; a lone reply that
      // never got wrapped falls through to the plain message renderer.
      return event.event === "agent.turn" ? (
        <AgentTurnContent event={event} />
      ) : (
        <AssistantContent event={event} />
      );
    case "lifecycle":
      return <LifecycleContent event={event} />;
    default:
      return null;
  }
}
EventContent.displayName = "EventContent";
