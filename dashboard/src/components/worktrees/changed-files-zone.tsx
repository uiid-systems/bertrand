import { useQuery } from "@tanstack/react-query";

import { Badge, List, ListItem, Separator, Stack } from "@uiid/design-system";

import { worktreeFilesQuery, worktreesQuery } from "../../api/queries";
import { SidebarZone } from "../sidebar/subcomponents/sidebar-zone";

import { ChangedFileRow } from "./changed-file-row";

export type ChangedFilesZoneProps = {
  /** The session the sidebar belongs to — only its worktree's diff is shown. */
  sessionId: string;
};

/**
 * Collapsible "Files changed" section for the secondary sidebar, below the
 * worktree zone: every file the session's worktree changed relative to its
 * merge base with the main branch, with +/- line counts. Renders nothing when
 * the session has no worktree or the diff is empty — an empty section is
 * noise, not signal.
 */
export const ChangedFilesZone = ({ sessionId }: ChangedFilesZoneProps) => {
  const { data: worktrees = [] } = useQuery(worktreesQuery);
  const entry = worktrees.find((w) => w.session.id === sessionId);

  const { data } = useQuery({
    ...worktreeFilesQuery(sessionId),
    enabled: !!entry?.session.worktreePath,
  });
  const files = data?.files ?? [];

  if (!entry || files.length === 0) return null;

  return (
    <SidebarZone
      data-slot="changed-files-zone"
      title="Files changed"
      badge={
        <Badge color="neutral" ml="auto">
          {files.length}
        </Badge>
      }
      PanelProps={{ style: { paddingBlock: 8 } }}
    >
      <Stack fullwidth gap={2}>
        <List marker="none" ax="stretch" gap={1} fullwidth>
          {files.map((file) => (
            <ListItem key={file.path}>
              <ChangedFileRow file={file} />
            </ListItem>
          ))}
        </List>
        <Separator />
      </Stack>
    </SidebarZone>
  );
};
ChangedFilesZone.displayName = "ChangedFilesZone";
