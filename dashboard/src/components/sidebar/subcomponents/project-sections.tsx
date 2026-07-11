import { useCallback } from "react";

import { Collapsible, Group, List, Stack, Text } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import type { SessionGroup } from "../sidebar.types";
import { useCollapsedProjects } from "../use-collapsed-projects";
import { SessionListItem } from "./session-list-item";

type ProjectSectionsProps = {
  projects: SessionGroup[];
};

/**
 * Zone B — the stable navigation area. One custom collapsible section per
 * project: a full-width trigger bar we style ourselves, content carrying its
 * own padding. Sections default to expanded; the user's collapses persist
 * across reloads via `useCollapsedProjects`.
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
    <Stack data-slot="sidebar-projects" ax="stretch" gap={1} fullwidth>
      {projects.map((group) => {
        const open = !collapsed.includes(group.key);
        return (
          <Collapsible
            key={group.key}
            instant
            RootProps={{
              open,
              onOpenChange: (next) => setOpen(group.key, next),
            }}
            PanelProps={{ style: { width: "100%", paddingBlock: 8 } }}
            trigger={
              <Group
                className="sidebar-zone-trigger"
                ay="center"
                gap={2}
                fullwidth
                px={4}
                py={2}
                style={{ cursor: "pointer" }}
              >
                {open ? (
                  <ChevronDownIcon size={14} />
                ) : (
                  <ChevronRightIcon size={14} />
                )}
                <Text className="sidebar-zone-title" weight="bold" size={0}>
                  {group.category}
                </Text>
                <Text size={-1} shade="muted">
                  {group.sessions.length}
                </Text>
              </Group>
            }
          >
            <List
              data-slot="sidebar-list"
              marker="none"
              ax="stretch"
              gap={1}
              fullwidth
              px={4}
            >
              {group.sessions.map((s) => (
                <SessionListItem key={s.session.id} session={s} />
              ))}
            </List>
          </Collapsible>
        );
      })}
    </Stack>
  );
};
ProjectSections.displayName = "ProjectSections";
