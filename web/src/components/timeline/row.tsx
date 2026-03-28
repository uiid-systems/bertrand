import { HugeiconsIcon } from "@hugeicons/react";
import { GitPullRequestIcon } from "@hugeicons/core-free-icons";

import { Group, Text } from "@uiid/design-system";

import { formatTime } from "./utils";

type RowProps = {
  ts: string;
  icon?: typeof GitPullRequestIcon;
  iconColor?: string;
  children: React.ReactNode;
};

export function Row({ ts, icon, iconColor, children }: RowProps) {
  return (
    <Group data-slot="timeline-row" gap={2} ay="center">
      <Time ts={ts} />
      {icon && <HugeiconsIcon icon={icon} size={14} className={iconColor} />}
      <div>{children}</div>
    </Group>
  );
}

const Time = ({ ts }: { ts: string }) => (
  <div className="w-12 h-5 rounded-sm bg-background flex items-center justify-center">
    <Text shade="muted" family="mono" className="text-[10px]!">
      {formatTime(ts)}
    </Text>
  </div>
);
