import { useQuery } from "@tanstack/react-query";
import { Group, Text } from "@uiid/design-system";
import { FilesIcon, GitBranchIcon } from "@uiid/icons";

import type { SessionWithCategory } from "@/types";
import { allStatsQuery, worktreesQuery } from "../../../api/queries";
import { formatRelativeTime } from "../../../lib/format";
import { useSessions } from "../../../lib/use-sessions";
import { useSelectedProjects } from "../selected-projects";
import { isLive } from "../sidebar.utils";

type SessionContentProps = {
  session: SessionWithCategory;
};

export const SessionContent = ({ session: s }: SessionContentProps) => {
  const { queryProjects } = useSelectedProjects();
  const sessions = useSessions();
  const hasLiveSession = sessions.some(isLive);
  const { data: allStats } = useQuery(
    allStatsQuery({ hasLiveSession, projects: queryProjects }),
  );
  const stats = allStats?.[s.session.id];
  const linesAdded = stats?.linesAdded ?? 0;
  const linesRemoved = stats?.linesRemoved ?? 0;
  const filesTouched = stats?.filesTouched ?? 0;
  const hasDiff = linesAdded > 0 || linesRemoved > 0;

  const { data: worktrees = [] } = useQuery(worktreesQuery);
  const hasWorktree = worktrees.some((w) => w.session.id === s.session.id);

  return (
    <Group ay="center" gap={2} fullwidth>
      {hasWorktree && (
        <Group ay="center" fullheight>
          <GitBranchIcon size={12} aria-label="Has a worktree" />
        </Group>
      )}
      {filesTouched > 0 && (
        <Group ay="start" gap={1}>
          <FilesIcon size={12} />
          <Text size={-1} family="mono" shade="muted">
            {filesTouched}
          </Text>
        </Group>
      )}
      {hasDiff && (
        <Group ay="center" gap={1}>
          <Text size={-1} family="mono" color="green">
            {`+${linesAdded}`}
          </Text>
          <Text size={-1} family="mono" color="red">
            {`-${linesRemoved}`}
          </Text>
        </Group>
      )}
      <Text
        size={-1}
        shade="muted"
        ml="auto"
        style={{ whiteSpace: "nowrap" }}
      >
        {formatRelativeTime(s.session.updatedAt)}
      </Text>
    </Group>
  );
};
SessionContent.displayName = "SessionContent";
