import { useMemo } from "react";

import { Badge, Number, Stack, Separator } from "@uiid/design-system";

import type { SessionListRow } from "@/types";

import { groupByRepo } from "../sidebar.utils";
import { useCollapsedLiveRepos } from "../use-collapsed";
import { SessionGroup } from "./session-group";
import { SidebarZone } from "./sidebar-zone";

type LiveZoneProps = {
  sessions: SessionListRow[];
};

/**
 * Zone A — the pinned "Active sessions" section: sessions waiting on the user
 * or actively running. Sits above the search box and renders nothing when
 * nothing is live, so it only takes space when something is actually running.
 *
 * Its rows span *every* repo and must keep doing so. The search box below
 * narrows the zone under this one, never this one — a session blocked on you in
 * another repo has to stay visible while you work in this one, which is the
 * whole point of a pinned inbox. Feed it the unfiltered session list.
 *
 * Because the rows cross repos they're grouped under a repo header, the same
 * shape the zone below uses. That header, not a prefix on every card, is what
 * tells you where a row belongs.
 */
export const LiveZone = ({ sessions }: LiveZoneProps) => {
  const { collapsed, toggle } = useCollapsedLiveRepos();
  const groups = useMemo(() => groupByRepo(sessions), [sessions]);

  if (sessions.length === 0) return null;

  return (
    <>
      <SidebarZone
        data-slot="sidebar-live-zone"
        title="Active sessions"
        // Explicit id so the persisted dim state is tied to the zone rather
        // than its label — the default keys off `title`, which would drop the
        // user's toggle every time this copy changes.
        zoneId="live"
        badge={
          <Badge color="blue">
            <Number size={-1} weight="bold" value={sessions.length} />
          </Badge>
        }
        PanelProps={{ style: { paddingBlock: 8 } }}
      >
        <Stack data-slot="sidebar-live-repos" ax="stretch" gap={3} fullwidth>
          {groups.map((group) => (
            <SessionGroup
              key={group.key}
              group={group}
              open={!collapsed.includes(group.key)}
              onOpenChange={(next) => toggle(group.key, next)}
            />
          ))}
        </Stack>
      </SidebarZone>
      <Separator />
    </>
  );
};
LiveZone.displayName = "LiveZone";
