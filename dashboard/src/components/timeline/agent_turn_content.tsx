import { Stack, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { summarizeAgentTurn } from "../../lib/format";
import { AssistantContent } from "./assistant_content";
import { useToolWorkVisible } from "./use-tool-work";
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
 *
 * The header's eye ({@link AgentTurnWorkToggle}) can drop the tool work from
 * that sequence, leaving the prose to read as a single uninterrupted reply. The
 * counts it hides stay visible as header badges, so nothing about the turn
 * becomes unknowable — it just stops interrupting the sentence you're reading.
 */
export const AgentTurnContent = ({ event }: AgentTurnContentProps) => {
  const meta = event.meta as Record<string, unknown> | null;
  const parts = (meta?.parts as EventRow[] | undefined) ?? [];
  const { visible: showWork } = useToolWorkVisible();

  // Defensive: a turn with no parts shouldn't reach the timeline (the transform
  // only wraps runs of 2+), but fall back to the plain message renderer rather
  // than render an empty card.
  if (parts.length === 0) return <AssistantContent event={event} />;

  const shown = showWork
    ? parts
    : parts.filter((part) => part.event === "assistant.message");

  // A turn can be tool work end to end — a long run of commands with no reply
  // between two prompts. Hiding the work would leave that card blank, which
  // reads as a rendering bug, so say what was hidden instead.
  if (shown.length === 0) {
    return (
      <Text size={-1} shade="muted" data-slot="agent-turn-work-hidden">
        {summarizeAgentTurn(event) ?? "Tool work"} hidden
      </Text>
    );
  }

  return (
    <Stack data-slot="agent-turn-content" gap={2} fullwidth>
      {shown.map((part) => (
        <AgentTurnPart key={part.id} part={part} />
      ))}
    </Stack>
  );
};
AgentTurnContent.displayName = "AgentTurnContent";

/**
 * A single member of a turn. Assistant prose renders as bare markdown — the
 * card title ("Agent's response") already frames it. Tool work renders as one
 * line that is both its title and its disclosure trigger, so a run of commands
 * and edits stays scannable inside the consolidated card no matter how much
 * detail each call carries.
 */
const AgentTurnPart = ({ part }: { part: EventRow }) => {
  if (part.event === "assistant.message") {
    return <AssistantContent event={part} />;
  }

  return (
    <Stack data-slot="agent-turn-work" gap={2} fullwidth>
      <WorkContent event={part} />
    </Stack>
  );
};
AgentTurnPart.displayName = "AgentTurnPart";
