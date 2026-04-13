import { Box, Text } from "@orchetron/storm";

import { formatBindings } from "@/tui/screens/launch/launch.utils";

interface ConfirmDeleteProps {
  sessionName: string;
  deleteBindings: Array<{ label: string; description: string }>;
}

export function ConfirmDelete({ sessionName, deleteBindings }: ConfirmDeleteProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="red">
        Delete session?
      </Text>
      <Box height={1} />
      <Text>
        This will permanently delete{" "}
        <Text bold>{sessionName}</Text>{" "}
        and all its conversations and events.
      </Text>
      <Box height={1} />
      <Text dim>{formatBindings(deleteBindings)}</Text>
    </Box>
  );
}
