import { Group, Text } from "@uiid/design-system";

import type { ChangedFile } from "../../api/types";

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

/**
 * One changed file, shared by the sidebar's "Files changed" zone and the
 * force-delete confirmation: muted directory + full-strength filename,
 * green/red line counts, git-style status letter.
 */
export const ChangedFileRow = ({ file }: { file: ChangedFile }) => {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = file.path.slice(slash + 1);

  return (
    <Group data-slot="changed-file" ay="center" gap={2} fullwidth>
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
  );
};
ChangedFileRow.displayName = "ChangedFileRow";
