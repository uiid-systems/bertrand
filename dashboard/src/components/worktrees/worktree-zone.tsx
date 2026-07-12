import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Collapsible, Group, Stack, Text } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import { worktreesQuery, worktreeStatusQuery } from "../../api/queries";
import { EDITORS, usePreferredEditor } from "../../lib/editor";

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
  const [editor, setEditor] = usePreferredEditor();
  const { data: worktrees = [] } = useQuery(worktreesQuery);
  const { data: statusById = {} } = useQuery(worktreeStatusQuery);

  if (worktrees.length === 0) return null;

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
        <Group ay="center" gap={2} pb={1}>
          <Text size={-1} shade="muted">
            Open in
          </Text>
          <Group gap={1} ay="center">
            {EDITORS.map((e) => (
              <Button
                key={e.id}
                size="xsmall"
                variant={editor === e.id ? "inverted" : "subtle"}
                aria-pressed={editor === e.id}
                onClick={() => setEditor(e.id)}
              >
                {e.label}
              </Button>
            ))}
          </Group>
        </Group>
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
