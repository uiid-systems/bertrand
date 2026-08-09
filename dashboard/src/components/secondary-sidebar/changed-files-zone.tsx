import { useQuery } from "@tanstack/react-query";

import { Badge, Group, Number, Text } from "@uiid/design-system";

import { changedFilesQuery } from "../../api/queries";
import { useSettledKeys } from "../../lib/use-settled-keys";
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
 * with diff — not just those with a live worktree.
 *
 * The zone always renders, a count of zero included: the sidebar's sections
 * are fixed landmarks, so "nothing changed yet" is stated in place rather than
 * leaving a gap that makes the sidebar's shape depend on the session.
 */
export const ChangedFilesZone = ({
  sessionId,
  isLive,
  projectSlug,
}: ChangedFilesZoneProps) => {
  const { data: files = [], isPending } = useQuery(
    changedFilesQuery(sessionId, isLive, projectSlug),
  );
  const settled = useSettledKeys(files, (f) => f.path);

  return (
    <SidebarZone
      data-slot="changed-files-zone"
      title="Files changed"
      badge={
        // Held back until the count is real — a `0` that flips to `12` reads
        // as a change in the session, not as the list arriving.
        isPending ? null : (
          <Badge color="neutral">
            <Number size={-1} weight="bold" value={files.length} />
          </Badge>
        )
      }
      PanelProps={{ style: { paddingBlock: 8 } }}
    >
      {files.length === 0 ? (
        <Group px={2} fullwidth>
          <Text size={-1} shade="muted">
            {isPending ? "Checking…" : "No files changed yet."}
          </Text>
        </Group>
      ) : (
        /* One grid for the whole list so the rows (each a `subgrid`) share
           column tracks and the counts line up tabularly. */
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
      )}
    </SidebarZone>
  );
};
ChangedFilesZone.displayName = "ChangedFilesZone";
