import {
  Group,
  Number,
  Reveal,
  Text,
  type TextProps,
} from "@uiid/design-system";

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
 * A path fragment. A row that appeared after its list settled fades in; every
 * other row renders as plain text with identical typography, so a revealed
 * fragment settles into exactly the static one.
 *
 * A path contains no whitespace, so Reveal splits it into a single span — the
 * effect is a blur-in of the fragment as a whole rather than a word-by-word
 * cascade. Both fragments animate at index 0, so the muted directory and the
 * filename come up together instead of staggering against each other.
 */
const PathFragment = ({
  text,
  isNew,
  ...props
}: Omit<TextProps, "children"> & { text: string; isNew: boolean }) =>
  isNew ? <Reveal {...props}>{text}</Reveal> : <Text {...props}>{text}</Text>;
PathFragment.displayName = "PathFragment";

/**
 * One changed file, shared by the sidebar's "Files changed" zone and the
 * force-delete confirmation: muted directory + full-strength filename,
 * green/red line counts, git-style status letter.
 *
 * The line counts are `Number`s so a file being actively edited ticks its
 * totals rather than snapping — number-flow animates only on value change, so
 * a static list (the force-delete confirmation) stays still with no gating.
 * The path only animates when the caller says the row is new, which is why
 * `isNew` defaults to false: the worktree list renders settled rows and should
 * not flicker.
 */
export const ChangedFileRow = ({
  file,
  isNew = false,
}: {
  file: ChangedFile;
  isNew?: boolean;
}) => {
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
      gap={2}
      style={{
        display: "grid",
        gridTemplateColumns: "subgrid",
        gridColumn: "1 / -1",
      }}
    >
      <Group ay="center" title={file.path} minw={0} pr={2}>
        {dir && (
          <PathFragment
            text={dir}
            isNew={isNew}
            size={-1}
            family="mono"
            shade="muted"
            truncate
            style={{ minWidth: 0 }}
          />
        )}
        <PathFragment
          text={name}
          isNew={isNew}
          size={-1}
          family="mono"
          style={{ flexShrink: 0 }}
        />
      </Group>
      {/* <Group gap={2} ay="center" ax="end"> */}
      {file.added != null && file.added > 0 && (
        <Number
          size={-1}
          family="mono"
          color="green"
          value={file.added}
          prefix="+"
          style={{ textAlign: "right" }}
        />
      )}
      {file.removed != null && file.removed > 0 && (
        <Number
          size={-1}
          family="mono"
          color="red"
          value={file.removed}
          prefix="-"
          style={{ textAlign: "right" }}
        />
      )}
      <Text
        size={-1}
        family="mono"
        color={STATUS_COLOR[file.status]}
        style={{ textAlign: "right" }}
      >
        {STATUS_LETTER[file.status]}
      </Text>
      {/* </Group> */}
    </Group>
  );
};
ChangedFileRow.displayName = "ChangedFileRow";
