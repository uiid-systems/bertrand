import { Collapsible, Group, List, Text } from "@uiid/design-system";

import type { CategoryGroup as CategoryGroupModel } from "../sidebar.types";
import { SessionListItem } from "./session-list-item";

type CategoryGroupProps = {
  group: CategoryGroupModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * One category's sessions inside the project zone, under a muted header that
 * doubles as a collapse trigger.
 *
 * The open/closed marker is a plain `-`/`+` rather than the chevron icon the
 * zone triggers use: this header sits a level below them, and matching their
 * affordance would flatten the hierarchy the indent is establishing.
 */
export const CategoryGroup = ({
  group,
  open,
  onOpenChange,
}: CategoryGroupProps) => (
  <Collapsible
    instant
    RootProps={{ open, onOpenChange }}
    TriggerProps={{ nativeButton: false }}
    PanelProps={{ style: { width: "100%" } }}
    trigger={
      <Group
        data-slot="sidebar-category-header"
        ay="center"
        gap={1}
        px={2}
        fullwidth
        style={{ cursor: "pointer" }}
      >
        <Text
          size={-1}
          shade="muted"
          truncate
          title={group.label}
          style={{ minWidth: 0 }}
        >
          {group.label}
        </Text>
        <Text size={-1} shade="muted" family="mono" aria-hidden>
          {open ? "-" : "+"}
        </Text>
      </Group>
    }
  >
    <List
      data-slot="sidebar-list"
      marker="none"
      ax="stretch"
      gap={1}
      fullwidth
      px={2}
      pt={1}
    >
      {group.sessions.map((s) => (
        <SessionListItem key={s.session.id} session={s} />
      ))}
    </List>
  </Collapsible>
);
CategoryGroup.displayName = "CategoryGroup";
