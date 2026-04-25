import { Activity } from "react";

import { Badge, Group, Input, Kbd, Stack, Text } from "@uiid/design-system";
import { SearchIcon } from "@uiid/icons";

import type { SessionWithGroup } from "../../api/types";

import { SessionItem } from "./session-item";
import { SidebarWrapper, type SidebarWrapperProps } from "./sidebar-wrapper";

export type SidebarProps = {
  sessions: SessionWithGroup[];
  WrapperProps?: SidebarWrapperProps;
};

export const Sidebar = ({ sessions, WrapperProps }: SidebarProps) => {
  const sessionCount = sessions.length;

  return (
    <SidebarWrapper {...WrapperProps}>
      <Input
        placeholder="Search for a session"
        before={<SearchIcon />}
        after={<Kbd hotkey={["meta", "k"]} />}
        size="small"
      />
      {sessions.map((s) => (
        <SessionItem key={s.session.id} session={s} />
      ))}
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";
