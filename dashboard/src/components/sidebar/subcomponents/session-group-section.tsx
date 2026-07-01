import { Stack, Group, Text, List } from "@uiid/design-system";
import type { SessionGroup } from "../sidebar.types";
import { SessionListItem } from "./session-list-item";

type SessionGroupSectionProps = {
  group: SessionGroup;
};

export const SessionGroupSection = ({ group }: SessionGroupSectionProps) => (
  <Stack data-slot="sidebar-list-section" ax="stretch" fullwidth>
    <Group ay="center" gap={2} py={1} fullwidth>
      <Text render={<h3 />} weight="bold" size={0}>
        {group.category}
      </Text>
      <Text size={-1} shade="muted">
        {group.sessions.length}
      </Text>
    </Group>
    <List data-slot="sidebar-list" marker="none" ax="stretch" gap={1} fullwidth>
      {group.sessions.map((s) => (
        <SessionListItem key={s.session.id} session={s} />
      ))}
    </List>
  </Stack>
);
SessionGroupSection.displayName = "SessionGroupSection";
