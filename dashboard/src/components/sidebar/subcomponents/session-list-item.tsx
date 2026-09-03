import { Link, useParams } from "@tanstack/react-router";

import { Card, Group, ListItem, Text } from "@uiid/design-system";

import type { SessionListRow } from "@/types";

import { statusColor, formatRelativeTime } from "../../../lib/format";

import { SessionLabel } from "./session-label";
import { SessionContent } from "./session-content";
import { SessionUsageBadge } from "./session-usage-badge";

type SessionListItemProps = {
  session: SessionListRow;
};

export const SessionListItem = ({ session: s }: SessionListItemProps) => {
  const isArchived = s.session.status === "archived";
  const color = statusColor(s.session.status);

  // Nothing to do on click beyond navigating. This used to also move the
  // sidebar's project filter to the row's project, so the zone below framed
  // whatever you opened. There is no filter to move: every repo is on screen
  // already and the row is under its own heading.

  // "You are here": the row for the session currently open in the detail view.
  // The route splat is exactly the slug (see findSessionFromSplat).
  const splat = s.session.slug;
  const { _splat } = useParams({ strict: false });
  const isCurrent = (_splat ?? "").replace(/^\/+|\/+$/g, "") === splat;

  // Outline follows status — green (active) / yellow (waiting) / red
  // (blocked on permission), white otherwise.
  const OUTLINE_BY_COLOR: Record<string, string> = {
    green: "var(--color-green)",
    yellow: "var(--color-yellow)",
    red: "var(--color-red)",
  };
  const outlineColor =
    OUTLINE_BY_COLOR[color] ?? "var(--globals-outline-color)";

  return (
    <ListItem
      data-slot="sidebar-session-list-item"
      data-archived={isArchived ? "" : undefined}
      style={isArchived ? { opacity: 0.4 } : undefined}
    >
      <Card
        render={<Link to="/$" params={{ _splat: splat }} />}
        InnerContainerProps={{ gap: 1 }}
        aria-current={isCurrent ? "page" : undefined}
        color={color}
        py={3}
        fullwidth
        style={
          isCurrent
            ? {
                outline: `var(--globals-outline-width) var(--globals-outline-style) ${outlineColor}`,
                outlineOffset: "var(--globals-outline-offset)",
              }
            : undefined
        }
      >
        <Group gap={3} ay="center" fullwidth>
          <SessionLabel session={s} />
          <Text
            size={-1}
            shade="muted"
            ml="auto"
            style={{ whiteSpace: "nowrap" }}
          >
            {formatRelativeTime(s.session.updatedAt)}
          </Text>
        </Group>
        <SessionContent session={s} />
      </Card>
    </ListItem>
  );
};
SessionListItem.displayName = "SessionListItem";
