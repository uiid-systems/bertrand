import { useEffect, useMemo, useRef, useState } from "react";

import { Input, Kbd } from "@uiid/design-system";
import { SearchIcon } from "@uiid/icons";

import { useAllSessions, useSessions } from "../../lib/use-sessions";

import { ProjectSelector } from "./subcomponents/project-selector";
import {
  groupByCategory,
  matchesQuery,
  selectLiveSessions,
} from "./sidebar.utils";

import { LiveZone } from "./subcomponents/live-zone";
import { ProjectZone } from "./subcomponents/project-zone";
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

  // Two scopes on purpose: "Active sessions" spans every project, the zone
  // below is narrowed to the selected one. Both come off the same poll.
  const allSessions = useAllSessions();
  const projectSessions = useSessions({ includeArchived });

  const q = query.trim().toLowerCase();

  // Search deliberately doesn't reach the live zone. That zone is a pinned
  // inbox — something blocked on you must not vanish because you typed a
  // filter for the project list underneath it. The input sits below the zone,
  // next to the selector it does narrow.
  const live = useMemo(() => selectLiveSessions(allSessions), [allSessions]);

  const categories = useMemo(
    () => groupByCategory(projectSessions.filter((s) => matchesQuery(s, q))),
    [projectSessions, q],
  );

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
      {/* Pinned to the top, above the project controls: what needs you comes
          before where you're browsing. Carries its own trailing separator. */}
      <LiveZone sessions={live} />

      <ProjectSelector />
      <Input
        ref={inputRef}
        placeholder="Search this project"
        before={<SearchIcon />}
        after={<Kbd hotkey={["meta", "k"]} />}
        size="small"
        fullwidth
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ProjectZone
        categories={categories}
        includeArchived={includeArchived}
        onIncludeArchivedChange={setIncludeArchived}
        emptyLabel={
          query.trim() ? `No sessions match "${query}".` : "No sessions yet."
        }
      />
    </SidebarWrapper>
  );
};
Sidebar.displayName = "Sidebar";
