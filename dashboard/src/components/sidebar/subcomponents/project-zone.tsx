import { Badge, Number, Stack, Text, ToggleButton } from "@uiid/design-system";
import { EyeIcon, EyeOffIcon } from "@uiid/icons";

import type { SessionGroup as SessionGroupModel } from "../sidebar.types";
import { useSelectedProject } from "../selected-project";
import {
  useCollapsedCategories,
  useCollapsedProjects,
  useEphemeralCollapsed,
} from "../use-collapsed";
import { SessionGroup } from "./session-group";
import { SidebarZone } from "./sidebar-zone";

type ProjectZoneProps = {
  categories: SessionGroupModel[];
  /**
   * A query is narrowing `categories`. Everything here is then a hit, so the
   * zone swaps its persisted collapse state for an ephemeral one that starts
   * expanded: a match rendered inside a group the reader shut days ago is a
   * match they never see, which reads as search being broken rather than as a
   * section being shut. Folding a group away during a search still works, it
   * just doesn't outlive the query.
   */
  searching: boolean;
  includeArchived: boolean;
  onIncludeArchivedChange: (next: boolean) => void;
  /** Shown in place of the list when nothing matches — phrased by the caller,
   * which knows whether a search is narrowing the view. */
  emptyLabel: string;
};

/**
 * Zone B — the selected project's sessions, titled by the project itself. Its
 * rows are grouped under a muted category header, most recently active group
 * first. Unlike the live zone this renders even when empty: the archived toggle
 * lives in its trigger bar, and a zone that vanished when the list emptied
 * would take the only way back to archived sessions with it.
 */
export const ProjectZone = ({
  categories,
  searching,
  includeArchived,
  onIncludeArchivedChange,
  emptyLabel,
}: ProjectZoneProps) => {
  const { projects, selected } = useSelectedProject();

  // Two stores per level, picked by whether a search is on. Selecting the store
  // rather than overriding `open` at the call site keeps "results start
  // expanded" and "collapsing a result group is temporary" as one rule.
  const persistedProjects = useCollapsedProjects();
  const persistedCategories = useCollapsedCategories();
  const searchProjects = useEphemeralCollapsed(searching);
  const searchCategories = useEphemeralCollapsed(searching);

  const projectCollapse = searching ? searchProjects : persistedProjects;
  const categoryCollapse = searching ? searchCategories : persistedCategories;

  if (selected === null) return null;
  const project = projects.find((p) => p.slug === selected);
  if (!project) return null;

  const total = categories.reduce((n, g) => n + g.sessions.length, 0);

  return (
    <SidebarZone
      data-slot="sidebar-project-zone"
      zoneId={project.slug}
      title={project.name}
      badge={
        <Badge color="neutral">
          <Number size={-1} weight="bold" value={total} />
        </Badge>
      }
      actions={
        <ToggleButton
          pressed={includeArchived}
          onPressedChange={onIncludeArchivedChange}
          size="xsmall"
          variant="ghost"
          shape="square"
          aria-label={includeArchived ? "Hide archived" : "Show archived"}
          tooltip={includeArchived ? "Hide archived" : "Show archived"}
          icon={{
            pressed: <EyeIcon size={13} />,
            unpressed: <EyeOffIcon size={13} />,
          }}
        />
      }
      open={!projectCollapse.collapsed.includes(project.slug)}
      onOpenChange={(next) => projectCollapse.toggle(project.slug, next)}
      RootProps={{ style: { marginBlockEnd: 8 } }}
      PanelProps={{ style: { paddingBlockStart: 8, paddingBlockEnd: 16 } }}
      TriggerGroupProps={{ mb: 2 }}
    >
      {categories.length === 0 ? (
        <Text size={-1} shade="muted" px={4} py={2}>
          {emptyLabel}
        </Text>
      ) : (
        <Stack data-slot="sidebar-categories" ax="stretch" gap={3} fullwidth>
          {categories.map((group) => (
            <SessionGroup
              key={group.key}
              group={group}
              // Namespaced by project: two projects can both have a `worktrees`
              // category, and collapsing one must not collapse the other.
              open={
                !categoryCollapse.collapsed.includes(
                  `${project.slug}/${group.key}`,
                )
              }
              onOpenChange={(next) =>
                categoryCollapse.toggle(`${project.slug}/${group.key}`, next)
              }
            />
          ))}
        </Stack>
      )}
    </SidebarZone>
  );
};
ProjectZone.displayName = "ProjectZone";
