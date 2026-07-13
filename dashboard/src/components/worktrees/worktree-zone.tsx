import { useQuery } from "@tanstack/react-query";

import { Separator, Stack } from "@uiid/design-system";

import { worktreesQuery } from "../../api/queries";
import { SidebarZone } from "../sidebar/subcomponents/sidebar-zone";

import { WorktreeItem } from "./worktree-item";

export type WorktreeZoneProps = {
  /** The session the sidebar belongs to — only its worktree is shown. */
  sessionId: string;
};

/**
 * Collapsible "Worktree" section for the secondary sidebar. The sidebar is
 * per-session, so this shows the one worktree belonging to the session being
 * viewed, with live preview state and controls. Renders nothing when the
 * session has no worktree — in a stats sidebar an empty section is noise,
 * not signal.
 */
export const WorktreeZone = ({ sessionId }: WorktreeZoneProps) => {
  const { data: worktrees = [] } = useQuery(worktreesQuery);

  const entry = worktrees.find((w) => w.session.id === sessionId);
  if (!entry) return null;

  return (
    <SidebarZone data-slot="worktree-zone" title="Worktree">
      <Stack fullwidth>
        <WorktreeItem entry={entry} preview={entry.status} />
        <Separator />
      </Stack>
    </SidebarZone>
  );
};
WorktreeZone.displayName = "WorktreeZone";
