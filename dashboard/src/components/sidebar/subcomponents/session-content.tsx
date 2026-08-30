import { useQuery } from "@tanstack/react-query";
import { Group, Text } from "@uiid/design-system";
import { FilesIcon } from "@uiid/icons";

import type { SessionListRow } from "@/types";
import { useAllStats } from "../../../lib/use-sessions";
import { SessionUsageBadge } from "./session-usage-badge";

type SessionContentProps = {
  session: SessionListRow;
};

export const SessionContent = ({ session: s }: SessionContentProps) => {
  const stats = useAllStats()[s.session.id];
  const linesAdded = stats?.linesAdded ?? 0;
  const linesRemoved = stats?.linesRemoved ?? 0;
  const filesTouched = stats?.filesTouched ?? 0;
  const hasDiff = linesAdded > 0 || linesRemoved > 0;

  return (
    <Group ay="center" gap={2} fullwidth>
      <SessionUsageBadge session={s} />
      <Text>&middot;</Text>
      <Group gap={2}>
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
      </Group>
    </Group>
  );
};
SessionContent.displayName = "SessionContent";
