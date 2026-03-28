import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";

import {
  Group,
  Text,
  Badge,
  Checkbox,
  type BadgeProps,
} from "@uiid/design-system";

import type { Session, Options, SessionStatus } from "@/lib/types";
import { parseSessionName } from "@/lib/sessions";
import { formatAgo } from "@/lib/format";

const badgeColors: Record<SessionStatus, BadgeProps["color"]> = {
  working: "green",
  blocked: "red",
  prompting: "yellow",
  paused: "purple",
  archived: "blue",
};

export const LogTrigger = ({
  session,
  options,
}: {
  session: Session;
  options?: Options;
}) => {
  const parsed = parseSessionName(session.session);
  const name = parsed.session;
  const ago = formatAgo(session.timestamp);
  return (
    <Group data-slot="log-trigger" gap={2} ay="center">
      {options?.onSelect && (
        <Checkbox
          label={`Select session ${name}`}
          checked={!!options.selected}
          onCheckedChange={(checked) =>
            options.onSelect!(session.session, checked)
          }
        />
      )}
      <Badge color={badgeColors[session.status]}>{session.status}</Badge>
      <Text size={-1} weight="bold">
        {name}
      </Text>
      {session.worktree && (
        <Badge color="blue">
          <HugeiconsIcon icon={GitBranchIcon} size={10} />
          {session.worktree}
        </Badge>
      )}
      <Text size={-1} shade="muted">
        {ago}
      </Text>
    </Group>
  );
};
LogTrigger.displayName = "LogTrigger";
