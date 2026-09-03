import { Collapsible, Group, List, Text } from "@uiid/design-system";

import type { SessionGroup as SessionGroupModel } from "../sidebar.types";
import { SessionListItem } from "./session-list-item";

type SessionGroupProps = {
  group: SessionGroupModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * One repo's sessions under a muted header that doubles as a collapse trigger.
 * Both zones share it so the two lists read as the same kind of thing at the
 * same depth, and so a repo folds the same way whether its sessions are live or
 * paused.
 *
 * The count sits beside the label because the header is often collapsed: it has
 * to say how much is behind it without being opened.
 *
 * The open/closed marker is a plain `-`/`+` rather than the chevron icon the
 * zone triggers use: this header sits a level below them, and matching their
 * affordance would flatten the hierarchy the indent is establishing.
 */
export const SessionGroup = ({
  group,
  open,
  onOpenChange,
}: SessionGroupProps) => (
  <Collapsible
    instant
    RootProps={{ open, onOpenChange }}
    TriggerProps={{ nativeButton: false }}
    PanelProps={{ style: { width: "100%" } }}
    trigger={
      <Group
        data-slot="sidebar-group-header"
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
        <Text size={-1} shade="muted" family="mono">
          ({group.sessions.length})
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
SessionGroup.displayName = "SessionGroup";
