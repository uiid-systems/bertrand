import { useState } from "react";

import {
  Badge,
  Collapsible,
  Group,
  List,
  Text,
  Separator,
} from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import type { SessionWithCategory } from "@/types";

import { SessionListItem } from "./session-list-item";

type LiveZoneProps = {
  sessions: SessionWithCategory[];
};

/**
 * Zone A — the pinned, cross-project "Needs you" section: sessions waiting on
 * the user or actively running. A custom collapsible: the trigger is a
 * full-width bar we own the styling of, the content carries its own padding.
 * Open by default. Renders nothing when nothing is live — the zone only earns
 * its space when something actually needs the user.
 */
export const LiveZone = ({ sessions }: LiveZoneProps) => {
  const [open, setOpen] = useState(true);

  if (sessions.length === 0) return null;

  return (
    <>
      <Collapsible
        instant
        RootProps={{ open, onOpenChange: setOpen }}
        TriggerProps={{ nativeButton: false }}
        PanelProps={{ style: { width: "100%", paddingBlock: 8 } }}
        trigger={
          <Group
            data-slot="sidebar-live-zone"
            className="sidebar-zone-trigger"
            ay="center"
            gap={2}
            fullwidth
            style={{ cursor: "pointer" }}
          >
            {open ? (
              <ChevronDownIcon size={14} />
            ) : (
              <ChevronRightIcon size={14} />
            )}
            <Text className="sidebar-zone-title" weight="bold" size={0}>
              Needs you
            </Text>
            <Badge color="blue" ml="auto">
              {sessions.length}
            </Badge>
          </Group>
        }
      >
        <List
          data-slot="sidebar-list"
          marker="none"
          ax="stretch"
          gap={1}
          fullwidth
        >
          {sessions.map((s) => (
            <SessionListItem key={s.session.id} session={s} />
          ))}
        </List>
      </Collapsible>
      <Separator py={0} />
    </>
  );
};
LiveZone.displayName = "LiveZone";
