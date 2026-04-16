import { Box, Text } from "@orchetron/storm";

import { useLaunchSessions } from "./use-launch-sessions";

export const NoSessions = () => {
  const { showArchived } = useLaunchSessions();

  return (
    <>
      <Box flexDirection="column">
        <Text dim>{showArchived ? "No sessions." : "No active sessions."}</Text>
      </Box>
      <Box flexDirection="row">
        <Text dim>Press </Text>
        <Text bold>n</Text>
        <Text dim> to create one</Text>
        {!showArchived && (
          <>
            <Text dim> · </Text>
            <Text bold>tab</Text>
            <Text dim> to show archived</Text>
          </>
        )}
      </Box>
    </>
  );
};
