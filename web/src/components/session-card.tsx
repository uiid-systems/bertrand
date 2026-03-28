import {
  Badge,
  Group,
  Text,
  type AccordionItemData,
  type BadgeProps,
} from "@uiid/design-system";

import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { Session, SessionStatus } from "@/lib/types";
import { formatAgo } from "@/lib/format";
import { parseSessionName } from "@/lib/sessions";
import { StatusDot } from "@/components/status-dot";
import { LogDrawer } from "@/components/log-drawer";
import { Checkbox } from "@/components/checkbox";

const badgeColors: Record<SessionStatus, BadgeProps["color"]> = {
  working: "green",
  blocked: "red",
  prompting: "yellow",
  paused: "purple",
  archived: "blue",
};

export function sessionToAccordionItem(
  session: Session,
  options?: {
    selected?: boolean;
    onSelect?: (name: string, checked: boolean) => void;
  },
): AccordionItemData {
  const parsed = parseSessionName(session.session);
  const name = parsed.session;
  const ago = formatAgo(session.timestamp);

  return {
    value: session.session,
    trigger: (
      <Group gap={2} ay="center">
        {options?.onSelect && (
          <Checkbox
            checked={!!options.selected}
            onChange={(checked) => options.onSelect!(session.session, checked)}
            label={`Select session ${name}`}
          />
        )}
        <StatusDot status={session.status} />
        <Text size={-1} weight="bold">
          {name}
        </Text>
        {session.worktree && (
          <Badge size="small" color="blue">
            <HugeiconsIcon icon={GitBranchIcon} size={10} />
            {session.worktree}
          </Badge>
        )}
        <Badge size="small" color={badgeColors[session.status]}>
          {session.status}
        </Badge>
        <Text size={-1} shade="muted">
          {ago}
        </Text>
      </Group>
    ),
    content: <LogDrawer sessionName={session.session} />,
  };
}
