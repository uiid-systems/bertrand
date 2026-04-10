import { Box, Text } from "@orchetron/storm";
import { StatusDot } from "./StatusDot.tsx";
import { formatAgo } from "../../lib/format.ts";

interface SessionRowProps {
  name: string;
  status: string;
  updatedAt: string;
  selected?: boolean;
}

export function SessionRow({
  name,
  status,
  updatedAt,
  selected,
}: SessionRowProps) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text>{selected ? "❯ " : "  "}</Text>
      <StatusDot status={status} />
      <Text bold={selected}>{name}</Text>
      <Text dim>{formatAgo(updatedAt)}</Text>
    </Box>
  );
}
