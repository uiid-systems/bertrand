import { Badge, Group, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { agentTurnStats } from "../../lib/format";

/**
 * Compact activity readout for a consolidated `agent.turn` card: the tool /
 * read / file counts as neutral badges, followed by green/red line deltas that
 * match the changed-files diff convention. Shown beside the timestamp in the
 * main timeline and as a sub-line in the sidebar table-of-contents. Renders
 * nothing for a non-turn card or a pure-prose turn that did no tool work.
 */
export const AgentTurnSummary = ({ event }: { event: EventRow }) => {
  const stats = agentTurnStats(event);
  if (!stats) return null;

  const { toolCalls, reads, filesEdited, linesAdded, linesRemoved } = stats;

  return (
    <Group data-slot="agent-turn-summary" gap={1} ay="center">
      <Badge color="neutral" size="small">
        {toolCalls} {toolCalls === 1 ? "tool" : "tools"}
      </Badge>
      {reads > 0 && (
        <Badge color="neutral" size="small">
          {reads} {reads === 1 ? "read" : "reads"}
        </Badge>
      )}
      {filesEdited > 0 && (
        <Badge color="neutral" size="small">
          {filesEdited} {filesEdited === 1 ? "file" : "files"}
        </Badge>
      )}
      {linesAdded > 0 && (
        <Text
          size={-1}
          family="mono"
          color="green"
          style={{ whiteSpace: "nowrap" }}
        >
          +{linesAdded}
        </Text>
      )}
      {linesRemoved > 0 && (
        <Text
          size={-1}
          family="mono"
          color="red"
          style={{ whiteSpace: "nowrap" }}
        >
          -{linesRemoved}
        </Text>
      )}
    </Group>
  );
};
AgentTurnSummary.displayName = "AgentTurnSummary";
