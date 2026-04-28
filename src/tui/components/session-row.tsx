import { Box, Text } from "@orchetron/storm";
import { formatAgo } from "@/lib/format";
import { StatusDot } from "./status-dot";

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
      <Text color={selected ? "green" : undefined} dim>
        {formatAgo(updatedAt)}
      </Text>
    </Box>
  );
}
