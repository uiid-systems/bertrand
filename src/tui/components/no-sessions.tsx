import { Box, Text } from "@orchetron/storm";

import { useLaunchSessions } from "@/tui/hooks/use-launch-sessions";

export const NoSessions = () => {
  const { showArchived } = useLaunchSessions();

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        {showArchived ? "You have no sessions." : "No active sessions."}
      </Text>
      <Box flexDirection="row">
        <Text dim>Press </Text>
        <Text bold>n</Text>
        <Text dim> to create one, or </Text>
        <Text bold>tab</Text>
        <Text dim> to show archived sessions.</Text>
      </Box>
    </Box>
  );
};
