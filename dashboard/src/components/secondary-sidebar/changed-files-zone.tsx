import { useQuery } from "@tanstack/react-query";

import { Badge, Group, Number, Stack, Text } from "@uiid/design-system";

import { changedFilesQuery } from "../../api/queries";
import { useSettledKeys } from "../../lib/use-settled-keys";
import { SidebarZone } from "../sidebar/subcomponents/sidebar-zone";
import { ChangedFileRow } from "./changed-file-row";
import { PullRequestCard } from "./pull-request-card";

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
 * session changed, with per-file +/- line counts, under the branch's pull
 * request when it has one.
 *
 * The PR sits here because this zone is the
 * session's GitHub-facing view: the files are the branch's diff, which is the
 * PR's diff, and the checks are what CI ran over exactly this list.
 *
 * Replayed from the session's `tool.applied` events, uniformly for every
 * session. There was a git arm that took precedence wherever a worktree
 * existed, reporting the branch's net change against its merge base; it went
 * with the worktrees. The replay counts each rewrite of a file separately, so
 * these numbers can read higher than a reviewer sees on the PR.
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
          <Badge color="neutral" size="small">
            <Number
              size={-1}
              weight="bold"
              family="mono"
              value={files.length}
            />
          </Badge>
        )
      }
      PanelProps={{ style: { paddingBlock: 8 } }}
    >
      <Stack gap={2} fullwidth>
        {/* Renders nothing for a branch with no PR, which is most of them —
            so the zone looks exactly as it did before whenever there's
            nothing to say. */}
        <PullRequestCard sessionId={sessionId} projectSlug={projectSlug} />
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
      </Stack>
    </SidebarZone>
  );
};
ChangedFilesZone.displayName = "ChangedFilesZone";
