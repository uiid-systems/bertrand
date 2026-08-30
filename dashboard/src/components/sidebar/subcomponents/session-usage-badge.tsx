import { Badge, Group, Text } from "@uiid/design-system";

import type { SessionListRow } from "@/types";
import { formatTokens } from "../../../lib/format";
import { standingFor, usagePeers } from "../../../lib/usage-standing";
import { useAllStats } from "../../../lib/use-sessions";

type SessionUsageBadgeProps = {
  session: SessionListRow;
};

/**
 * A session's output tokens, coloured by how heavy it is relative to every
 * other known session. Ranking against the same set the secondary sidebar uses
 * keeps a session reading the same weight in both places — and the set has to
 * span projects, since the live zone's rows do.
 *
 * Renders nothing when no output was captured — sessions predating usage
 * capture would otherwise all show a misleading "lightest" green.
 */
export const SessionUsageBadge = ({ session: s }: SessionUsageBadgeProps) => {
  const allStats = useAllStats();

  const outputTokens = allStats[s.session.id]?.outputTokens ?? 0;
  if (outputTokens === 0) return null;

  const standing = standingFor(outputTokens, usagePeers(allStats));

  return (
    <Text size={-1} family="mono" color={standing.color}>
      {formatTokens(outputTokens)}
    </Text>
  );
};
SessionUsageBadge.displayName = "SessionUsageBadge";
