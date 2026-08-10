import { Badge, List, Number, Separator } from "@uiid/design-system";

import type { SessionWithCategory } from "@/types";

import { SessionListItem } from "./session-list-item";
import { SidebarZone } from "./sidebar-zone";

type LiveZoneProps = {
  sessions: SessionWithCategory[];
};

/**
 * Zone A — the pinned "Active sessions" section: sessions waiting on the user
 * or actively running. Sits above the project controls and renders nothing when
 * nothing is live, so it only takes space when something is actually running.
 *
 * Its rows span *every* project and must keep doing so. The project selector
 * and search below narrow the zone under this one, never this one — a session
 * blocked on you elsewhere has to stay visible while you work in another
 * project, which is the whole point of a pinned inbox. Feed it the unscoped,
 * unfiltered session list.
 */
export const LiveZone = ({ sessions }: LiveZoneProps) => {
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
        <List
          data-slot="sidebar-list"
          marker="none"
          ax="stretch"
          gap={1}
          px={2}
          fullwidth
        >
          {sessions.map((s) => (
            <SessionListItem key={s.session.id} session={s} showProject />
          ))}
        </List>
      </SidebarZone>
      <Separator />
    </>
  );
};
LiveZone.displayName = "LiveZone";
