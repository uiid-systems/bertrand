import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Group,
  Input,
  Kbd,
  Stack,
  Text,
  Toggle,
  ToggleButton,
  ToggleGroup,
  Tooltip,
} from "@uiid/design-system";
import {
  TagsIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  GroupIcon,
  SearchIcon,
} from "@uiid/icons";

import { sessionsQuery } from "../../api/queries";

import { useSelectedProjects } from "./selected-projects";
import { ProjectSelector } from "./subcomponents/project-selector";
import type { GroupBy } from "./sidebar.types";
import { groupSessions } from "./sidebar.utils";

import { SessionGroupSection } from "./subcomponents/session-group-section";
import {
  SidebarWrapper,
  type SidebarWrapperProps,
} from "./subcomponents/sidebar-wrapper";

export type SidebarProps = {
  WrapperProps?: SidebarWrapperProps;
};

export const Sidebar = ({ WrapperProps }: SidebarProps) => {
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("group");
  const [includeArchived, setIncludeArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { queryProjects } = useSelectedProjects();
  const { data: sessions = [] } = useQuery(
    sessionsQuery({ includeArchived, projects: queryProjects }),
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.session.slug.toLowerCase().includes(q) ||
            s.session.name.toLowerCase().includes(q) ||
            s.categoryPath.toLowerCase().includes(q),
        )
      : sessions;
    return groupSessions(filtered, groupBy);
  }, [sessions, query, groupBy]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarWrapper {...WrapperProps}>
      <ProjectSelector />
      <Group ay="center" gap={2} fullwidth>
        <Input
          ref={inputRef}
          placeholder="Search for a session"
          before={<SearchIcon />}
          after={<Kbd hotkey={["meta", "k"]} />}
          size="small"
          fullwidth
          style={{ flex: 1, minWidth: 0 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Group>
      <Group ay="center" ax="space-between" gap={2}>
        <ToggleGroup
          size="sm"
          value={[groupBy]}
          onValueChange={(value) => {
            const next = value[0] as GroupBy | undefined;
            if (next) setGroupBy(next);
          }}
        >
          <Toggle value="group" aria-label="Group by group">
            <Tooltip trigger={<GroupIcon />}>Group by group</Tooltip>
          </Toggle>
          <Toggle value="status" aria-label="Group by status">
            <Tooltip trigger={<TagsIcon />}>Group by status</Tooltip>
          </Toggle>
          <Toggle value="recent" aria-label="Group by recent">
            <Tooltip trigger={<ClockIcon />}>Group by recent</Tooltip>
          </Toggle>
        </ToggleGroup>
        <Group ay="center" gap={1}>
          <ToggleButton
            size="small"
            shape="square"
            variant="subtle"
            tooltip={includeArchived ? "Hide archived" : "Show archived"}
            pressed={includeArchived}
            onPressedChange={setIncludeArchived}
            icon={{
              unpressed: <EyeOffIcon />,
              pressed: <EyeIcon />,
            }}
          />
        </Group>
      </Group>
      {groups.length === 0 ? (
        <Text size={-1} shade="muted" style={{ padding: "0.5rem" }}>
          No sessions match "{query}".
        </Text>
      ) : (
        <Stack ax="stretch" gap={3} fullwidth>
          {groups.map((group) => (
            <SessionGroupSection key={group.key} group={group} />
          ))}
        </Stack>
      )}
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";
