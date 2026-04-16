import { Box, Text } from "@orchetron/storm";
import { StatusDot } from "./status-dot";
import { formatAgo } from "@/lib/format";

export interface SessionRowProps {
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
      <Text color="green">{selected ? "❯ " : "  "}</Text>
      <StatusDot status={status} />
      <Text bold={selected} color={selected ? "green" : undefined}>
        {name}
      </Text>
      <Text dim>Updated {formatAgo(updatedAt)}</Text>
    </Box>
  );
}
