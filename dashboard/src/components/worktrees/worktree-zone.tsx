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
 * viewed, with live preview state and controls.
 *
 * The zone always renders, including for sessions with no worktree: it's a
 * fixed landmark at the top of the sidebar, and "no worktree" is a fact about
 * the session worth stating rather than an absence to hide. Hiding it also
 * made the sidebar's shape jump between sessions.
 */
export const WorktreeZone = ({ sessionId }: WorktreeZoneProps) => {
  const { data: worktrees, isPending } = useQuery(worktreesQuery);

  const entry = worktrees?.find((w) => w.session.id === sessionId);

  return (
    <SidebarZone data-slot="worktree-zone" title="Worktree">
      <WorktreeItem
        sessionId={sessionId}
        entry={entry}
        preview={entry?.status}
        pending={isPending}
      />
    </SidebarZone>
  );
};
WorktreeZone.displayName = "WorktreeZone";
