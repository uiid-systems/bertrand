import { Badge, List, Number, Text, ToggleButton } from "@uiid/design-system";
import { EyeIcon, EyeOffIcon } from "@uiid/icons";

import type { SessionListRow } from "../../../api/types";
import { useSelectedProject } from "../selected-project";
import { useCollapsedProjects, useEphemeralCollapsed } from "../use-collapsed";
import { SessionListItem } from "./session-list-item";
import { SidebarZone } from "./sidebar-zone";

type ProjectZoneProps = {
  sessions: SessionListRow[];
  /**
   * A query is narrowing `sessions`. Everything here is then a hit, so the
   * zone swaps its persisted collapse state for an ephemeral one that starts
   * expanded: a match rendered inside a zone the reader shut days ago is a
   * match they never see, which reads as search being broken rather than as a
   * section being shut. Folding the zone away during a search still works, it
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
 * Zone B — the selected project's sessions, titled by the project itself, as
 * one flat list ordered by recency (sessions are flat since ELKY-171). Unlike
 * the live zone this renders even when empty: the archived toggle lives in its
 * trigger bar, and a zone that vanished when the list emptied would take the
 * only way back to archived sessions with it.
 */
export const ProjectZone = ({
  sessions,
  searching,
  includeArchived,
  onIncludeArchivedChange,
  emptyLabel,
}: ProjectZoneProps) => {
  const { projects, selected } = useSelectedProject();

  // Two stores, picked by whether a search is on. Selecting the store rather
  // than overriding `open` at the call site keeps "results start expanded" and
  // "collapsing a result zone is temporary" as one rule.
  const persistedProjects = useCollapsedProjects();
  const searchProjects = useEphemeralCollapsed(searching);
  const projectCollapse = searching ? searchProjects : persistedProjects;

  if (selected === null) return null;
  const project = projects.find((p) => p.slug === selected);
  if (!project) return null;

  return (
    <SidebarZone
      data-slot="sidebar-project-zone"
      zoneId={project.slug}
      title={project.name}
      badge={
        <Badge color="neutral" size="small">
          <Number size={-1} weight="bold" family="mono" value={sessions.length} />
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
      {sessions.length === 0 ? (
        <Text size={-1} shade="muted" px={4} py={2}>
          {emptyLabel}
        </Text>
      ) : (
        <List
          data-slot="sidebar-list"
          marker="none"
          ax="stretch"
          gap={1}
          fullwidth
          px={2}
          pt={1}
        >
          {sessions.map((s) => (
            <SessionListItem key={s.session.id} session={s} />
          ))}
        </List>
      )}
    </SidebarZone>
  );
};
ProjectZone.displayName = "ProjectZone";
