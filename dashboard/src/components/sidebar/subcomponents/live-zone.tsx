import { useState } from "react";

import { Collapsible, Group, List, Text } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import type { SessionWithCategory } from "@/types";

import { SessionListItem } from "./session-list-item";

type LiveZoneProps = {
  sessions: SessionWithCategory[];
  /**
   * Show the reassuring empty state when there's nothing live. Suppressed while
   * a search is narrowing the list, where a "nothing needs you" line would be
   * noise rather than signal.
   */
  showEmpty: boolean;
};

/**
 * Zone A — the pinned, cross-project "Needs you" section: sessions waiting on
 * the user or actively running. A custom collapsible: the trigger is a
 * full-width bar we own the styling of, the content carries its own padding.
 * Open by default. An empty zone is a feature — "nothing needs you" is a calm,
 * legible state — so it keeps its place with copy rather than vanishing, except
 * while searching.
 */
export const LiveZone = ({ sessions, showEmpty }: LiveZoneProps) => {
  const [open, setOpen] = useState(true);

  if (sessions.length === 0 && !showEmpty) return null;

  return (
    <Collapsible
      instant
      RootProps={{ open, onOpenChange: setOpen }}
      PanelProps={{ style: { width: "100%", paddingBlock: 8 } }}
      trigger={
        <Group
          data-slot="sidebar-live-zone"
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
          <Text weight="bold" size={0}>
            Needs you
          </Text>
          <Text size={-1} shade="muted">
            {sessions.length}
          </Text>
        </Group>
      }
    >
      {sessions.length === 0 ? (
        <Text size={-1} shade="muted" px={4} py={1}>
          Nothing needs you right now.
        </Text>
      ) : (
        <List
          data-slot="sidebar-list"
          marker="none"
          ax="stretch"
          gap={1}
          fullwidth
          px={4}
        >
          {sessions.map((s) => (
            <SessionListItem key={s.session.id} session={s} />
          ))}
        </List>
      )}
    </Collapsible>
  );
};
LiveZone.displayName = "LiveZone";
