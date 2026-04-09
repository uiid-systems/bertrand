import { Text } from "@orchetron/storm";

const STATUS_COLORS: Record<string, string> = {
  working: "#34D399",
  blocked: "#F59E0B",
  prompting: "#60A5FA",
  paused: "#6B7280",
  archived: "#374151",
};

export function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "#6B7280";
  return <Text color={color}>●</Text>;
}
