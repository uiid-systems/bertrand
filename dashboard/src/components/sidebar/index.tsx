import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Group,
  Input,
  Kbd,
  Stack,
  Text,
  ToggleButton,
} from "@uiid/design-system";
import { EyeIcon, EyeOffIcon, SearchIcon } from "@uiid/icons";

import { sessionsQuery } from "../../api/queries";

import { useSelectedProjects } from "./selected-projects";
import { ProjectSelector } from "./subcomponents/project-selector";
import { buildSidebarLayout } from "./sidebar.utils";

import { LiveZone } from "./subcomponents/live-zone";
import { ProjectSections } from "./subcomponents/project-sections";
import {
  SidebarWrapper,
  type SidebarWrapperProps,
} from "./subcomponents/sidebar-wrapper";

export type SidebarProps = {
  WrapperProps?: SidebarWrapperProps;
};

export const Sidebar = ({ WrapperProps }: SidebarProps) => {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { queryProjects } = useSelectedProjects();
  const { data: sessions = [] } = useQuery(
    sessionsQuery({ includeArchived, projects: queryProjects }),
  );

  const trimmedQuery = query.trim();

  const { live, projects } = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    const filtered = q
      ? sessions.filter(
          (s) =>
            s.session.slug.toLowerCase().includes(q) ||
            s.session.name.toLowerCase().includes(q) ||
            s.categoryPath.toLowerCase().includes(q),
        )
      : sessions;
    return buildSidebarLayout(filtered);
  }, [sessions, trimmedQuery]);

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

  const isEmpty = live.length === 0 && projects.length === 0;

  return (
    <SidebarWrapper {...WrapperProps}>
      {/* Header controls carry their own horizontal inset now that the
          sidebar container is full-bleed and section triggers span edge-to-edge. */}
      <Stack ax="stretch" gap={3} fullwidth p={4}>
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
          <ToggleButton
            size="small"
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
      </Stack>

      {isEmpty ? (
        <Text size={-1} shade="muted" px={4} py={2}>
          {trimmedQuery ? `No sessions match "${query}".` : "No sessions yet."}
        </Text>
      ) : (
        <Stack ax="stretch" gap={3} fullwidth>
          <LiveZone sessions={live} showEmpty={!trimmedQuery} />
          {projects.length > 0 && <ProjectSections projects={projects} />}
        </Stack>
      )}
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";
