import { Link, useParams } from "@tanstack/react-router";

import { Card, Group, ListItem } from "@uiid/design-system";

import type { SessionWithCategory } from "@/types";

import { statusColor } from "../../../lib/format";

import { SessionLabel } from "./session-label";
import { SessionContent } from "./session-content";
import { SessionUsageBadge } from "./session-usage-badge";

type SessionListItemProps = {
  session: SessionWithCategory;
};

export const SessionListItem = ({ session: s }: SessionListItemProps) => {
  const isArchived = s.session.status === "archived";
  const color = statusColor(s.session.status);

  // "You are here": the row for the session currently open in the detail view.
  // The route splat is exactly `<categoryPath>/<slug>` (see findSessionFromSplat).
  const splat = `${s.categoryPath}/${s.session.slug}`;
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
        color={color === "neutral" ? undefined : color}
        p={2}
        fullwidth
        InnerContainerProps={{ gap: 1 }}
        aria-current={isCurrent ? "page" : undefined}
        style={
          isCurrent
            ? {
                outline: `var(--globals-outline-width) var(--globals-outline-style) ${outlineColor}`,
                outlineOffset: "var(--globals-outline-offset)",
              }
            : undefined
        }
      >
        <Group gap={2} ay="center" fullwidth>
          <SessionLabel session={s} />
          <SessionUsageBadge session={s} />
        </Group>
        <SessionContent session={s} />
      </Card>
    </ListItem>
  );
};
SessionListItem.displayName = "SessionListItem";
