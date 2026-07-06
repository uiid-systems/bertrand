import { Link } from "@tanstack/react-router";

import { Card, Group, ListItem, Text } from "@uiid/design-system";

import type { SessionWithCategory } from "@/types";

import { formatRelativeTime, statusColor } from "../../../lib/format";

import { SessionLabel } from "./session-label";
import { SessionContent } from "./session-content";

type SessionListItemProps = {
  session: SessionWithCategory;
};

export const SessionListItem = ({ session: s }: SessionListItemProps) => {
  const isArchived = s.session.status === "archived";
  const backgroundColor = statusColor(s.session.status);

  return (
    <ListItem
      data-slot="sidebar-session-list-item"
      data-archived={isArchived ? "" : undefined}
      style={isArchived ? { opacity: 0.4 } : undefined}
    >
      <Card
        render={
          <Link
            to="/$"
            params={{ _splat: `${s.categoryPath}/${s.session.slug}` }}
          />
        }
        p={2}
        fullwidth
        style={{ backgroundColor }}
      >
        <Group gap={2} ay="center" fullwidth>
          <SessionLabel session={s} />
          <Text size={-1} shade="muted" ml="auto">
            {formatRelativeTime(s.session.startedAt)}
          </Text>
        </Group>
        <SessionContent session={s} />
      </Card>
    </ListItem>
  );
};
SessionListItem.displayName = "SessionListItem";
