import { useEffect, useMemo, useRef, useState } from "react";

import {
  Group,
  Input,
  Kbd,
  Text,
  ToggleButton,
  Separator,
} from "@uiid/design-system";
import { EyeIcon, EyeOffIcon, SearchIcon } from "@uiid/icons";

import { useSessions } from "../../lib/use-sessions";

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

const GAP = 2;

export const Sidebar = ({ WrapperProps }: SidebarProps) => {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessions = useSessions({ includeArchived });

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
      <ProjectSelector gap={GAP} />
      <Group ay="center" gap={GAP} fullwidth>
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

      <Separator />

      {isEmpty ? (
        <Text size={-1} shade="muted" px={4} py={2}>
          {trimmedQuery ? `No sessions match "${query}".` : "No sessions yet."}
        </Text>
      ) : (
        <>
          <LiveZone sessions={live} />
          {projects.length > 0 && <ProjectSections projects={projects} />}
        </>
      )}
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";
