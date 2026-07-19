import { useCallback } from "react";

import { Badge, List, Stack } from "@uiid/design-system";

import type { SessionGroup } from "../sidebar.types";
import { useCollapsedProjects } from "../use-collapsed-projects";
import { SessionListItem } from "./session-list-item";
import { SidebarZone } from "./sidebar-zone";

type ProjectSectionsProps = {
  projects: SessionGroup[];
};

/**
 * Zone B — the stable navigation area. One collapsible section per project.
 * Sections default to expanded; the user's collapses persist across reloads
 * via `useCollapsedProjects`.
 */
export const ProjectSections = ({ projects }: ProjectSectionsProps) => {
  const { collapsed, setCollapsed } = useCollapsedProjects();

  const setOpen = useCallback(
    (key: string, open: boolean) => {
      // Everything already in `collapsed` (including offscreen projects filtered
      // out by search or the selector) is preserved; we only flip this key.
      const rest = collapsed.filter((k) => k !== key);
      setCollapsed(open ? rest : [...rest, key]);
    },
    [collapsed, setCollapsed],
  );

  return (
    <Stack data-slot="sidebar-projects" ax="stretch" fullwidth>
      {projects.map((group) => (
        <SidebarZone
          key={group.key}
          zoneId={group.key}
          title={group.category}
          badge={
            <Badge color="neutral">{group.sessions.length}</Badge>
          }
          open={!collapsed.includes(group.key)}
          onOpenChange={(next) => setOpen(group.key, next)}
          RootProps={{ style: { marginBlockEnd: 8 } }}
          PanelProps={{
            style: { paddingBlockStart: 8, paddingBlockEnd: 16 },
          }}
          TriggerGroupProps={{ mb: 2 }}
        >
          <List
            data-slot="sidebar-list"
            marker="none"
            ax="stretch"
            gap={1}
            fullwidth
            px={2}
          >
            {group.sessions.map((s) => (
              <SessionListItem key={s.session.id} session={s} />
            ))}
          </List>
        </SidebarZone>
      ))}
    </Stack>
  );
};
ProjectSections.displayName = "ProjectSections";
