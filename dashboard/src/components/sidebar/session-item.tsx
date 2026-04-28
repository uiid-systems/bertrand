import { Link } from "@tanstack/react-router";
import {
  Badge,
  Group,
  type GroupProps,
  Stack,
  Status,
  type StatusProps,
  Text,
} from "@uiid/design-system";
import type { SessionWithGroup } from "../../api/types";
import { formatRelativeTime, statusColor } from "../../lib/format";

export type SessionItem = Omit<GroupProps, "children"> & {
  session: SessionWithGroup;
};

export const SessionItem = ({ session: s, ...props }: SessionItem) => {
  const { groupPath, session } = s;
  const color = statusColor(session.status);

  return (
    <Group data-slot="session-item" ay="center" gap={2} ml={2} {...props}>
      <Group gap={2} ay="center">
        <Status
          data-slot="session-status"
          color={color as StatusProps["color"]}
        />

        <Stack gap={2}>
          <Text
            data-slot="session-link"
            render={
              <Link
                to="/sessions/$slug"
                params={{ slug: session.slug }}
              />
            }
            weight="bold"
          >
            {groupPath} / {session.slug}
          </Text>
        </Stack>
        <Text data-slot="session-time" size={-1} shade="muted">
          {formatRelativeTime(session.startedAt)}
        </Text>
      </Group>
      <Badge
        data-slot="session-badge"
        color={color as StatusProps["color"]}
        ml="auto"
      >
        {session.status}
      </Badge>
    </Group>
  );
};
SessionItem.displayName = "SessionItem";
