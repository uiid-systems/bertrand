import { useQuery } from "@tanstack/react-query";
import { Badge, Group, Text } from "@uiid/design-system";

import type { SessionWithCategory } from "@/types";
import { allStatsQuery } from "../../../api/queries";
import { formatTokens } from "../../../lib/format";
import { standingFor, usagePeers } from "../../../lib/usage-standing";
import { useSessions } from "../../../lib/use-sessions";
import { useSelectedProjects } from "../selected-projects";
import { isLive } from "../sidebar.utils";

type SessionUsageBadgeProps = {
  session: SessionWithCategory;
};

/**
 * A session's output tokens, coloured by how heavy it is relative to the
 * other sessions in view. Ranking against the same selection the secondary
 * sidebar uses keeps a session reading the same weight in both places.
 *
 * Renders nothing when no output was captured — sessions predating usage
 * capture would otherwise all show a misleading "lightest" green.
 */
export const SessionUsageBadge = ({ session: s }: SessionUsageBadgeProps) => {
  const { queryProjects } = useSelectedProjects();
  const sessions = useSessions();
  const hasLiveSession = sessions.some(isLive);
  const { data: allStats } = useQuery(
    allStatsQuery({ hasLiveSession, projects: queryProjects }),
  );

  const outputTokens = allStats?.[s.session.id]?.outputTokens ?? 0;
  if (outputTokens === 0) return null;

  const standing = standingFor(outputTokens, usagePeers(allStats));

  return (
    <Group ml="auto">
      <Badge color={standing.color} title={standing.title}>
        <Text size={-1} weight="bold">
          {formatTokens(outputTokens)}
        </Text>
      </Badge>
    </Group>
  );
};
SessionUsageBadge.displayName = "SessionUsageBadge";
