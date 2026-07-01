import {
  ListItem,
  Stack,
  Group,
  Status,
  type StatusProps,
} from "@uiid/design-system";
import type { SessionWithCategory } from "@/types";
import { statusColor } from "../../../lib/format";
import { SessionLabel } from "./session-label";
import { SessionRowActions } from "./session-row-actions";
import { SessionContent } from "./session-content";

type SessionListItemProps = {
  session: SessionWithCategory;
};

export const SessionListItem = ({ session: s }: SessionListItemProps) => {
  const color = statusColor(s.session.status) as StatusProps["color"];
  const isArchived = s.session.status === "archived";
  return (
    <ListItem
      data-archived={isArchived ? "" : undefined}
      style={isArchived ? { opacity: 0.4 } : undefined}
    >
      <Stack fullwidth>
        <Group ay="center" gap={2} fullwidth>
          <Status color={color} />
          <SessionLabel session={s} />
          <SessionRowActions
            session={s.session}
            categoryPath={s.categoryPath}
          />
        </Group>
        <SessionContent session={s} />
      </Stack>
    </ListItem>
  );
};
SessionListItem.displayName = "SessionListItem";
