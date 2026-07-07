import { useCallback, useMemo } from "react";

import { Accordion, Group, List, Text } from "@uiid/design-system";

import type { SessionGroup } from "../sidebar.types";
import { useCollapsedProjects } from "../use-collapsed-projects";
import { SessionListItem } from "./session-list-item";

type ProjectAccordionProps = {
  projects: SessionGroup[];
};

/**
 * Zone B — the stable navigation area. One collapsible section per project
 * (ghost variant, so no card chrome). Sections default to expanded; the user's
 * collapses persist across reloads via `useCollapsedProjects`.
 */
export const ProjectAccordion = ({ projects }: ProjectAccordionProps) => {
  const { collapsed, setCollapsed } = useCollapsedProjects();

  const allKeys = useMemo(() => projects.map((g) => g.key), [projects]);
  const openValue = useMemo(
    () => allKeys.filter((k) => !collapsed.includes(k)),
    [allKeys, collapsed],
  );

  const handleChange = useCallback(
    (value: unknown[]) => {
      const open = value.filter((v): v is string => typeof v === "string");
      // Keep collapsed state for projects not currently on screen (filtered out
      // by search or the project selector) so it survives their return.
      const offscreen = collapsed.filter((k) => !allKeys.includes(k));
      const nowCollapsed = allKeys.filter((k) => !open.includes(k));
      setCollapsed([...offscreen, ...nowCollapsed]);
    },
    [allKeys, collapsed, setCollapsed],
  );

  const items = useMemo(
    () =>
      projects.map((group) => ({
        value: group.key,
        trigger: (
          <Group ay="center" gap={2} fullwidth>
            <Text weight="bold" size={0}>
              {group.category}
            </Text>
            <Text size={-1} shade="muted">
              {group.sessions.length}
            </Text>
          </Group>
        ),
        content: (
          <List
            data-slot="sidebar-list"
            marker="none"
            ax="stretch"
            gap={1}
            fullwidth
          >
            {group.sessions.map((s) => (
              <SessionListItem key={s.session.id} session={s} />
            ))}
          </List>
        ),
      })),
    [projects],
  );

  return (
    <Accordion
      data-slot="sidebar-projects"
      ghost
      multiple
      size="small"
      fullwidth
      value={openValue}
      onValueChange={handleChange}
      items={items}
      ContentProps={{ p: 0, fullwidth: true }}
      PanelProps={{ style: { overflow: "visible", transition: "none" } }}
    />
  );
};
ProjectAccordion.displayName = "ProjectAccordion";
