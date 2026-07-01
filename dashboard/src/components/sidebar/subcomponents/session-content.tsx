import { useQuery } from "@tanstack/react-query";
import { Group, Text } from "@uiid/design-system";
import { FilesIcon } from "@uiid/icons";

import type { SessionWithCategory } from "@/types";
import { allStatsQuery, sessionsQuery } from "../../../api/queries";
import { formatRelativeTime } from "../../../lib/format";

type SessionContentProps = {
  session: SessionWithCategory;
};

export const SessionContent = ({ session: s }: SessionContentProps) => {
  const { data: sessions = [] } = useQuery(sessionsQuery());
  const hasLiveSession = sessions.some(
    (x) => x.session.status === "active" || x.session.status === "waiting",
  );
  const { data: allStats } = useQuery(allStatsQuery(hasLiveSession));
  const stats = allStats?.[s.session.id];
  const linesAdded = stats?.linesAdded ?? 0;
  const linesRemoved = stats?.linesRemoved ?? 0;
  const filesTouched = stats?.filesTouched ?? 0;
  const hasDiff = linesAdded > 0 || linesRemoved > 0;

  return (
    <Group ay="center" gap={2}>
      <Text size={-1} shade="muted">
        {formatRelativeTime(s.session.startedAt)}
      </Text>
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
      {filesTouched > 0 && (
        <Group ay="start" gap={1}>
          <FilesIcon size={12} />
          <Text size={-1} family="mono" shade="muted">
            {filesTouched}
          </Text>
        </Group>
      )}
      {s.session.rating !== null && s.session.rating !== undefined && (
        <Text aria-label={`Rated ${s.session.rating} of 5 stars`}>
          {[1, 2, 3, 4, 5]
            .map((n) => (n <= s.session.rating! ? "★" : "☆"))
            .join("")}
        </Text>
      )}
    </Group>
  );
};
SessionContent.displayName = "SessionContent";
