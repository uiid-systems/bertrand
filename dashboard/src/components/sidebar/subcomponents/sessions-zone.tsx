import { useMemo } from "react";

import { Badge, Number, Stack, Text, ToggleButton } from "@uiid/design-system";
import { EyeIcon, EyeOffIcon } from "@uiid/icons";

import type { SessionListRow } from "../../../api/types";
import { groupByRepo } from "../sidebar.utils";
import { useCollapsedRepos, useEphemeralCollapsed } from "../use-collapsed";
import { SessionGroup } from "./session-group";
import { SidebarZone } from "./sidebar-zone";

type SessionsZoneProps = {
  sessions: SessionListRow[];
  /**
   * A query is narrowing `sessions`. Everything here is then a hit, so the
   * groups swap their persisted collapse state for an ephemeral one that
   * starts expanded: a match rendered inside a group the reader shut days ago
   * is a match they never see, which reads as search being broken rather than
   * as a section being shut. Folding a group during a search still works, it
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
 * Zone B — every session that isn't pinned above, grouped by the repo its cwd
 * resolved to and ordered so the repo you touched most recently leads.
 *
 * This replaced a zone titled after the *selected project*, with a switcher
 * above it that chose which project's sessions to list at all. Nothing is
 * selected any more and nothing needs to be: one DB holds every session, each
 * row says which repo it ran in, and so all of them can be on screen at once
 * under headings nobody had to register. The switcher's real job — "show me
 * the work in this repo" — is now a heading you can fold.
 *
 * Unlike the live zone this renders even when empty: the archived toggle lives
 * in its trigger bar, and a zone that vanished when the list emptied would
 * take the only way back to archived sessions with it.
 */
export const SessionsZone = ({
  sessions,
  searching,
  includeArchived,
  onIncludeArchivedChange,
  emptyLabel,
}: SessionsZoneProps) => {
  // Two stores, picked by whether a search is on. Selecting the store rather
  // than overriding `open` at the call site keeps "results start expanded" and
  // "collapsing a result group is temporary" as one rule.
  const persisted = useCollapsedRepos();
  const ephemeral = useEphemeralCollapsed(searching);
  const collapse = searching ? ephemeral : persisted;

  // `sessions` arrives sorted newest-first and `groupByRepo` preserves that
  // order, so the group holding the freshest session leads and its rows stay
  // in recency order — no second sort, and no group order to keep in sync.
  const groups = useMemo(() => groupByRepo(sessions), [sessions]);

  return (
    <SidebarZone
      data-slot="sidebar-sessions-zone"
      zoneId="sessions"
      title="Sessions"
      badge={
        <Badge color="neutral" size="small">
          <Number
            size={-1}
            weight="bold"
            family="mono"
            value={sessions.length}
          />
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
      RootProps={{ style: { marginBlockEnd: 8 } }}
      PanelProps={{ style: { paddingBlockStart: 8, paddingBlockEnd: 16 } }}
      TriggerGroupProps={{ mb: 2 }}
    >
      {groups.length === 0 ? (
        <Text size={-1} shade="muted" px={4} py={2}>
          {emptyLabel}
        </Text>
      ) : (
        <Stack data-slot="sidebar-repos" ax="stretch" gap={3} fullwidth>
          {groups.map((group) => (
            <SessionGroup
              key={group.key}
              group={group}
              open={!collapse.collapsed.includes(group.key)}
              onOpenChange={(next) => collapse.toggle(group.key, next)}
            />
          ))}
        </Stack>
      )}
    </SidebarZone>
  );
};
SessionsZone.displayName = "SessionsZone";
