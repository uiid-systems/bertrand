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
 * session changed, with per-file +/- line counts.
 *
 * Git-derived while the session has a worktree — the branch's net change
 * against its merge base, so these counts are the ones a reviewer sees on the
 * PR. Sessions without a worktree fall back to a replay of the session's
 * `tool.applied` events, so the list still appears for every session; that arm
 * counts each rewrite of a file separately and can read higher. The server
 * picks between them, so the two never appear at once.
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
