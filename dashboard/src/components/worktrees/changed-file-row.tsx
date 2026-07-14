import { Group, Text } from "@uiid/design-system";

import type { ChangedFile } from "../../api/types";

const STATUS_LETTER: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  untracked: "?",
};

const STATUS_COLOR: Record<ChangedFile["status"], "green" | "yellow" | "red"> =
  {
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
    // A subgrid row: the parent list defines the two column tracks
    // (`minmax(0, 1fr) auto`) and every row adopts them via `subgrid`, so the
    // counts column sizes to the widest counts across ALL rows — a clean
    // tabular line the path truncates against, instead of the boundary drifting
    // with each row's path/counts length.
    <Group
      data-slot="changed-file-row"
      ay="center"
      gap={4}
      style={{
        display: "grid",
        gridTemplateColumns: "subgrid",
        gridColumn: "1 / -1",
      }}
    >
      <Group ay="center" title={file.path} minw={0}>
        {dir && (
          <Text
            size={-1}
            family="mono"
            shade="muted"
            truncate
            style={{ minWidth: 0 }}
          >
            {dir}
          </Text>
        )}
        <Text size={-1} family="mono" style={{ flexShrink: 0 }}>
          {name}
        </Text>
      </Group>
      <Group gap={2} ay="center" ax="end">
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
