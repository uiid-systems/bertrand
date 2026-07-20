import { Badge, List, Separator } from "@uiid/design-system";

import type { SessionWithCategory } from "@/types";

import { SessionListItem } from "./session-list-item";
import { SidebarZone } from "./sidebar-zone";

type LiveZoneProps = {
  sessions: SessionWithCategory[];
};

/**
 * Zone A — the pinned, cross-project "Needs you" section: sessions waiting on
 * the user or actively running. Renders nothing when nothing is live — the
 * zone only earns its space when something actually needs the user.
 */
export const LiveZone = ({ sessions }: LiveZoneProps) => {
  if (sessions.length === 0) return null;

  return (
    <>
      <SidebarZone
        data-slot="sidebar-live-zone"
        title="Needs you"
        badge={
          <Badge color="blue">{sessions.length}</Badge>
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
            <SessionListItem key={s.session.id} session={s} />
          ))}
        </List>
      </SidebarZone>
      <Separator />
    </>
  );
};
LiveZone.displayName = "LiveZone";
