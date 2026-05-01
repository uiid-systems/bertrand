import { useMemo } from "react";
import { Link } from "@tanstack/react-router";

import {
  Badge,
  Input,
  Kbd,
  List,
  type ListItemGroupProps,
  type ListItemProps,
  type StatusProps,
  Text,
} from "@uiid/design-system";
import { SearchIcon } from "@uiid/icons";

import type { SessionWithGroup } from "../../api/types";
import { formatRelativeTime, statusColor } from "../../lib/format";

import { SidebarWrapper, type SidebarWrapperProps } from "./sidebar-wrapper";

export type SidebarProps = {
  sessions: SessionWithGroup[];
  WrapperProps?: SidebarWrapperProps;
};

function groupSessions(sessions: SessionWithGroup[]): ListItemGroupProps[] {
  const groups = new Map<string, SessionWithGroup[]>();

  for (const s of sessions) {
    const key = s.groupPath;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return Array.from(
    groups,
    ([category, items]): ListItemGroupProps => ({
      category,
      collapsible: true,
      items: items.map((s) => {
        const color = statusColor(s.session.status) as StatusProps["color"];
        return {
          value: s.session.id,
          label: <SessionLabel session={s} />,
          content: <SessionContent session={s} />,
          action: <Badge color={color}>{s.session.status}</Badge>,
        } as ListItemProps;
      }),
    }),
  );
}

export const Sidebar = ({ sessions, WrapperProps }: SidebarProps) => {
  const items = useMemo(() => groupSessions(sessions), [sessions]);

  return (
    <SidebarWrapper {...WrapperProps}>
      <Input
        placeholder="Search for a session"
        before={<SearchIcon />}
        after={<Kbd hotkey={["meta", "k"]} />}
        size="small"
      />
      <List items={items} line />
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";

const SessionLabel = ({ session: s }: { session: SessionWithGroup }) => (
  <Link to="/sessions/$slug" params={{ slug: s.session.slug }}>
    {s.session.slug}
  </Link>
);
SessionLabel.displayName = "SessionLabel";

const SessionContent = ({ session: s }: { session: SessionWithGroup }) => (
  <Text size={-1} shade="muted">
    {formatRelativeTime(s.session.startedAt)}
  </Text>
);
SessionContent.displayName = "SessionContent";
