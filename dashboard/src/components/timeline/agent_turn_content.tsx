import { Stack, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { eventColor, eventTitle } from "../../lib/format";
import { AssistantContent } from "./assistant_content";
import { WorkContent } from "./work_content";

type AgentTurnContentProps = Readonly<{
  event: EventRow;
}>;

/**
 * One consolidated agent turn: the run of prose replies and tool work the agent
 * produced between two human touch-points, folded into a single card by the
 * `consolidateAgentTurns` transform. The members live in `meta.parts` and are
 * rendered here in order, so the turn reads exactly as it did when each part was
 * its own timeline card — the card just carries one rail marker and one time
 * badge instead of dozens.
 */
export const AgentTurnContent = ({ event }: AgentTurnContentProps) => {
  const meta = event.meta as Record<string, unknown> | null;
  const parts = (meta?.parts as EventRow[] | undefined) ?? [];

  // Defensive: a turn with no parts shouldn't reach the timeline (the transform
  // only wraps runs of 2+), but fall back to the plain message renderer rather
  // than render an empty card.
  if (parts.length === 0) return <AssistantContent event={event} />;

  return (
    <Stack data-slot="agent-turn-content" gap={2} fullwidth>
      {parts.map((part) => (
        <AgentTurnPart key={part.id} part={part} />
      ))}
    </Stack>
  );
};
AgentTurnContent.displayName = "AgentTurnContent";

/**
 * A single member of a turn. Assistant prose renders as bare markdown — the
 * card title ("Agent's response") already frames it. Tool work keeps the little
 * colored summary line each work card used to show as its title, so a run of
 * commands and edits stays scannable inside the consolidated card.
 */
const AgentTurnPart = ({ part }: { part: EventRow }) => {
  if (part.event === "assistant.message") {
    return <AssistantContent event={part} />;
  }

  return (
    <Stack data-slot="agent-turn-work" gap={2} fullwidth>
      <Text size={-1} weight="medium" color={eventColor(part.event)}>
        {eventTitle(part)}
      </Text>
      <WorkContent event={part} />
    </Stack>
  );
};
AgentTurnPart.displayName = "AgentTurnPart";
