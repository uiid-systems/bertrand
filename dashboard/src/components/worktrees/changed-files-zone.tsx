import { useQuery } from "@tanstack/react-query";

import {
  Badge,
  Group,
  List,
  ListItem,
  Separator,
  Stack,
  Text,
} from "@uiid/design-system";

import { worktreeFilesQuery, worktreesQuery } from "../../api/queries";
import type { ChangedFile } from "../../api/types";
import { SidebarZone } from "../sidebar/subcomponents/sidebar-zone";

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
            <FileRow key={file.path} file={file} />
          ))}
        </List>
        <Separator />
      </Stack>
    </SidebarZone>
  );
};
ChangedFilesZone.displayName = "ChangedFilesZone";

const truncate = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/** Git-style status letter; `?` mirrors `git status`'s untracked marker. */
const STATUS_LETTER: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  untracked: "?",
};

const STATUS_COLOR: Record<ChangedFile["status"], "green" | "yellow" | "red"> = {
  added: "green",
  untracked: "green",
  modified: "yellow",
  deleted: "red",
};

const FileRow = ({ file }: { file: ChangedFile }) => {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = file.path.slice(slash + 1);

  return (
    <ListItem data-slot="changed-file">
      <Group ay="center" gap={2} fullwidth>
        {/* Directory muted, filename full-strength — the filename is the
            signal; truncation eats from the whole path's tail as one block. */}
        <Text
          size={-1}
          family="mono"
          title={file.path}
          style={{ ...truncate, flex: "1 1 auto", minWidth: 0 }}
        >
          {dir && (
            <Text size={-1} family="mono" shade="muted" render={<span />}>
              {dir}
            </Text>
          )}
          {name}
        </Text>
        <Group gap={1} ay="center" style={{ flexShrink: 0 }}>
          {file.added != null && file.added > 0 && (
            <Text size={-1} family="mono" color="green">
              +{file.added}
            </Text>
          )}
          {file.removed != null && file.removed > 0 && (
            <Text size={-1} family="mono" color="red">
              -{file.removed}
            </Text>
          )}
          <Text size={-1} family="mono" color={STATUS_COLOR[file.status]}>
            {STATUS_LETTER[file.status]}
          </Text>
        </Group>
      </Group>
    </ListItem>
  );
};
FileRow.displayName = "FileRow";
