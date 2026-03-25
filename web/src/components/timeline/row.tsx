import { HugeiconsIcon } from "@hugeicons/react";
import { GitPullRequestIcon } from "@hugeicons/core-free-icons";

import { Group } from "@uiid/layout";
import { Text } from "@uiid/typography";

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
      <div className="w-12 h-5 rounded-sm bg-background flex items-center justify-center">
        <Text shade="muted" family="mono" className="text-[10px]!">
          {formatTime(ts)}
        </Text>
      </div>
      <span className="w-4 shrink-0 flex items-center justify-center pt-px">
        {icon ? (
          <HugeiconsIcon
            icon={icon}
            size={14}
            className={iconColor ?? "text-muted-foreground"}
          />
        ) : (
          <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
        )}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </Group>
  );
}
