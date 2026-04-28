import { Box } from "@orchetron/storm";

import { SessionRow } from "@/tui/components/session-row";

import { useLaunchSessions } from "../../hooks/use-launch-sessions";

export const SessionRows = () => {
  const { sessionRows, cursor } = useLaunchSessions();

  return (
    <Box flexDirection="column">
      {sessionRows.map((row, i) => (
        <SessionRow
          key={row.session.id}
          name={`${row.groupPath}/${row.session.slug}`}
          status={row.session.status}
          updatedAt={row.session.updatedAt}
          selected={i === cursor}
        />
      ))}
    </Box>
  );
};
