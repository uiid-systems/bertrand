import { useQuery } from "@tanstack/react-query";

import { Badge, Group } from "@uiid/design-system";

import { changedFilesQuery } from "../../api/queries";
import { SidebarZone } from "../sidebar/subcomponents/sidebar-zone";
import { ChangedFileRow } from "../worktrees/changed-file-row";

export type ChangedFilesZoneProps = {
  /** The session the sidebar belongs to — only its changed files are shown. */
  sessionId: string;
  /** Live sessions poll for new edits; paused ones fetch once. */
  isLive?: boolean;
  /** Project the session belongs to, so the diff resolves against the right DB. */
  projectSlug?: string;
};

/**
 * Collapsible "Files changed" section for the secondary sidebar: every file the
 * session touched over its lifetime, with per-file +/- line counts. The list is
 * derived from the session's timeline (the same `tool.applied` events behind
 * the primary sidebar's file-count/+- totals), so it appears for every session
 * with diff — not just those with a live worktree. Renders nothing when the
 * session changed no files — an empty section is noise, not signal.
 */
export const ChangedFilesZone = ({
  sessionId,
  isLive,
  projectSlug,
}: ChangedFilesZoneProps) => {
  const { data: files = [] } = useQuery(
    changedFilesQuery(sessionId, isLive, projectSlug),
  );

  if (files.length === 0) return null;

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
      {/* One grid for the whole list so the rows (each a `subgrid`) share
          column tracks and the counts line up tabularly. */}
      <Group
        px={2}
        gap={1}
        fullwidth
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto auto auto",
        }}
      >
        {files.map((file) => (
          <ChangedFileRow key={file.path} file={file} />
        ))}
      </Group>
    </SidebarZone>
  );
};
ChangedFilesZone.displayName = "ChangedFilesZone";
