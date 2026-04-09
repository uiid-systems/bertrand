import { Box, Text } from "@orchetron/storm";
import { StatusDot } from "./StatusDot.tsx";
import { formatAgo } from "../../lib/format.ts";

interface SessionRowProps {
  name: string;
  status: string;
  updatedAt: string;
  selected?: boolean;
}

export function SessionRow({ name, status, updatedAt, selected }: SessionRowProps) {
  return (
    <Box>
      <Text>{selected ? "❯ " : "  "}</Text>
      <StatusDot status={status} />
      <Text> </Text>
      <Text bold={selected}>{name}</Text>
      <Text> </Text>
      <Text dim>{formatAgo(updatedAt)}</Text>
    </Box>
  );
}
