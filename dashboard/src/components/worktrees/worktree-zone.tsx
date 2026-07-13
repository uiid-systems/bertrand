import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Collapsible,
  Group,
  Separator,
  Stack,
  Text,
} from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import { worktreesQuery } from "../../api/queries";

import { WorktreeItem } from "./worktree-item";

export type WorktreeZoneProps = {
  /** The session the sidebar belongs to — only its worktree is shown. */
  sessionId: string;
};

/**
 * Collapsible "Worktree" section for the secondary sidebar — the same
 * custom-collapsible pattern as the primary sidebar's zones (full-width
 * trigger bar, chevron + title, open by default). The sidebar is per-session,
 * so this shows the one worktree belonging to the session being viewed, with
 * live preview state and controls. Renders nothing when the session has no
 * worktree — in a stats sidebar an empty section is noise, not signal.
 */
export const WorktreeZone = ({ sessionId }: WorktreeZoneProps) => {
  const [open, setOpen] = useState(true);
  const { data: worktrees = [] } = useQuery(worktreesQuery);

  const entry = worktrees.find((w) => w.session.id === sessionId);
  if (!entry) return null;

  return (
    <Collapsible
      instant
      RootProps={{ open, onOpenChange: setOpen }}
      TriggerProps={{ nativeButton: false }}
      PanelProps={{ style: { width: "100%" } }}
      trigger={
        <Group
          data-slot="worktree-zone"
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
            Worktree
          </Text>
        </Group>
      }
    >
      <Stack fullwidth>
        <WorktreeItem entry={entry} preview={entry.status} />
        <Separator />
      </Stack>
    </Collapsible>
  );
};
WorktreeZone.displayName = "WorktreeZone";
