import { Link } from "@tanstack/react-router";
import {
  Badge,
  Group,
  type GroupProps,
  Stack,
  Status,
  Text,
} from "@uiid/design-system";
import type { SessionWithCategory } from "../../../api/types";
import {
  formatRelativeTime,
  statusColor,
  statusLabel,
} from "../../../lib/format";
import { CopyResumeButton } from "../../copy-resume-button";

export type SessionItem = Omit<GroupProps, "children"> & {
  session: SessionWithCategory;
};

export const SessionItem = ({ session: s, ...props }: SessionItem) => {
  const { categoryPath, session } = s;
  const color = statusColor(session.status);

  return (
    <Group data-slot="session-item" ay="center" gap={2} ml={2} {...props}>
      <Group gap={2} ay="center">
        <Status data-slot="session-status" color={color} />

        <Stack gap={2}>
          <Text
            data-slot="session-link"
            render={
              <Link
                to="/$"
                params={{ _splat: `${categoryPath}/${session.slug}` }}
              />
            }
            weight="bold"
          >
            {categoryPath} / {session.slug}
          </Text>
        </Stack>
        <Text
          data-slot="session-time"
          size={-1}
          shade="muted"
          style={{ whiteSpace: "nowrap" }}
        >
          {formatRelativeTime(session.startedAt)}
        </Text>
      </Group>
      <Badge data-slot="session-badge" color={color} ml="auto">
        {statusLabel(session.status)}
      </Badge>
      <CopyResumeButton session={session} categoryPath={categoryPath} />
    </Group>
  );
};
SessionItem.displayName = "SessionItem";
