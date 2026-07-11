import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge, Collapsible, Group, Stack, Text } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import { worktreesQuery, worktreeStatusQuery } from "../../api/queries";

import { WorktreeItem } from "./worktree-item";

/**
 * Collapsible "Worktrees" section for the secondary sidebar — the same
 * custom-collapsible pattern as the primary sidebar's zones (full-width
 * trigger bar, chevron + title + count badge, open by default). Lists every
 * worktree-bearing session with live preview state and controls; the row for
 * the session being viewed is marked aria-current. Renders nothing when no
 * session holds a worktree — in a stats sidebar an empty section is noise,
 * not signal.
 */
export const WorktreeZone = () => {
  const [open, setOpen] = useState(true);
  const { data: worktrees = [] } = useQuery(worktreesQuery);
  const { data: statusById = {} } = useQuery(worktreeStatusQuery);

  if (worktrees.length === 0) return null;

  return (
    <Collapsible
      instant
      RootProps={{ open, onOpenChange: setOpen }}
      PanelProps={{ style: { width: "100%" } }}
      trigger={
        <Group
          data-slot="worktree-zone"
          className="sidebar-zone-trigger"
          ay="center"
          gap={2}
          px={4}
          py={2}
          fullwidth
          style={{ cursor: "pointer" }}
        >
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
          <Text className="sidebar-zone-title" weight="bold" size={0}>
            Worktrees
          </Text>
          <Badge ml="auto">{worktrees.length}</Badge>
        </Group>
      }
    >
      <Stack ax="stretch" gap={1} fullwidth px={4} py={2}>
        {worktrees.map((entry) => (
          <WorktreeItem
            key={entry.session.id}
            entry={entry}
            preview={statusById[entry.session.id]}
          />
        ))}
      </Stack>
    </Collapsible>
  );
};
WorktreeZone.displayName = "WorktreeZone";
