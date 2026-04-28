import { Text } from "@orchetron/storm";

const STATUS_COLORS: Record<string, string> = {
  active: "orange",
  waiting: "red",
  paused: "gold",
  archived: "purple",
};

export function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#6B7280";
  return <Text color={color}>●</Text>;
}
