import { useMemo } from "react";

import { Accordion, Group, List, Text } from "@uiid/design-system";

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
 * the user or actively running. Same ghost accordion treatment as the project
 * sections, open by default. An empty zone is a feature — "nothing needs you"
 * is a calm, legible state — so it keeps its place with copy rather than
 * vanishing, except while searching.
 */
export const LiveZone = ({ sessions, showEmpty }: LiveZoneProps) => {
  const items = useMemo(
    () => [
      {
        value: "live",
        trigger: (
          <Group ay="center" gap={2} fullwidth>
            <Text weight="bold" size={0}>
              Needs you
            </Text>
            <Text size={-1} shade="muted">
              {sessions.length}
            </Text>
          </Group>
        ),
        content:
          sessions.length === 0 ? (
            <Text
              size={-1}
              shade="muted"
              style={{ padding: "0.25rem 0.5rem" }}
            >
              Nothing needs you right now.
            </Text>
          ) : (
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
          ),
      },
    ],
    [sessions],
  );

  if (sessions.length === 0 && !showEmpty) return null;

  return (
    <Accordion
      data-slot="sidebar-live-zone"
      ghost
      multiple
      size="small"
      fullwidth
      defaultValue={["live"]}
      items={items}
      ContentProps={{ p: 0, fullwidth: true }}
      // Animation disabled for now — matches the project sections.
      PanelProps={{ style: { overflow: "visible", transition: "none" } }}
    />
  );
};
LiveZone.displayName = "LiveZone";
