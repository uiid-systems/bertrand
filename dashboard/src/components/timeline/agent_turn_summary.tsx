import { Badge, Group, Number } from "@uiid/design-system";

import type { EventRow } from "../../api/types";
import { agentTurnStats } from "../../lib/format";

/**
 * Compact activity readout for a consolidated `agent.turn` card: the tool /
 * read / file counts as neutral badges, followed by green/red line deltas that
 * match the changed-files diff convention. Shown beside the timestamp in the
 * main timeline and as a sub-line in the sidebar table-of-contents. Renders
 * nothing for a non-turn card or a pure-prose turn that did no tool work.
 *
 * Every figure is a `Number` rather than plain text: while a turn is live these
 * counts climb every poll, and number-flow animates only on value *change* —
 * first paint is static, so replaying a finished session stays still while a
 * running one visibly ticks. The badge figures repeat `size`/`weight` because
 * Badge wraps its children in its own `Text`, and a nested Number would
 * otherwise fall back to the default type size and outgrow its label.
 */
export const AgentTurnSummary = ({ event }: { event: EventRow }) => {
  const stats = agentTurnStats(event);
  if (!stats) return null;

  const { toolCalls, reads, filesEdited, linesAdded, linesRemoved } = stats;

  return (
    <Group data-slot="agent-turn-summary" gap={1} ay="center">
      <Badge color="neutral" size="small">
        <Number
          size={-1}
          weight="bold"
          value={toolCalls}
          suffix={toolCalls === 1 ? " tool" : " tools"}
        />
      </Badge>
      {reads > 0 && (
        <Badge color="neutral" size="small">
          <Number
            size={-1}
            weight="bold"
            value={reads}
            suffix={reads === 1 ? " read" : " reads"}
          />
        </Badge>
      )}
      {filesEdited > 0 && (
        <Badge color="neutral" size="small">
          <Number
            size={-1}
            weight="bold"
            value={filesEdited}
            suffix={filesEdited === 1 ? " file" : " files"}
          />
        </Badge>
      )}
      {linesAdded > 0 && (
        <Number
          size={-1}
          family="mono"
          color="green"
          value={linesAdded}
          prefix="+"
          style={{ whiteSpace: "nowrap" }}
        />
      )}
      {linesRemoved > 0 && (
        <Number
          size={-1}
          family="mono"
          color="red"
          value={linesRemoved}
          prefix="-"
          style={{ whiteSpace: "nowrap" }}
        />
      )}
    </Group>
  );
};
AgentTurnSummary.displayName = "AgentTurnSummary";
