import { Badge, Number, Stack, Text, ToggleButton } from "@uiid/design-system";
import { EyeIcon, EyeOffIcon } from "@uiid/icons";

import type { CategoryGroup as CategoryGroupModel } from "../sidebar.types";
import { useSelectedProject } from "../selected-project";
import {
  useCollapsedCategories,
  useCollapsedProjects,
} from "../use-collapsed";
import { CategoryGroup } from "./category-group";
import { SidebarZone } from "./sidebar-zone";

type ProjectZoneProps = {
  categories: CategoryGroupModel[];
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
  includeArchived,
  onIncludeArchivedChange,
  emptyLabel,
}: ProjectZoneProps) => {
  const { projects, selected } = useSelectedProject();
  const { collapsed, toggle } = useCollapsedProjects();
  const { collapsed: collapsedCategories, toggle: toggleCategory } =
    useCollapsedCategories();

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
      open={!collapsed.includes(project.slug)}
      onOpenChange={(next) => toggle(project.slug, next)}
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
            <CategoryGroup
              key={group.key}
              group={group}
              // Namespaced by project: two projects can both have a `worktrees`
              // category, and collapsing one must not collapse the other.
              open={!collapsedCategories.includes(`${project.slug}/${group.key}`)}
              onOpenChange={(next) =>
                toggleCategory(`${project.slug}/${group.key}`, next)
              }
            />
          ))}
        </Stack>
      )}
    </SidebarZone>
  );
};
ProjectZone.displayName = "ProjectZone";
