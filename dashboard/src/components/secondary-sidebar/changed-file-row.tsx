import { Group, Number, Text } from "@uiid/design-system";

import type { ChangedFile } from "../../api/types";

export const ChangedFileRow = ({ file }: { file: ChangedFile }) => {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = file.path.slice(slash + 1);

  return (
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
          <Text size={-1} shade="muted" truncate>
            {dir}
          </Text>
        )}
        <Text size={-1} truncate style={{ flexShrink: 0 }}>
          {name}
        </Text>
      </Group>
      {file.added != null && file.added > 0 && (
        <Number
          size={-1}
          color="green"
          value={file.added}
          prefix="+"
          style={{ textAlign: "right" }}
        />
      )}
      {file.removed != null && file.removed > 0 && (
        <Number
          size={-1}
          color="red"
          value={file.removed}
          prefix="-"
          style={{ textAlign: "right" }}
        />
      )}
    </Group>
  );
};
ChangedFileRow.displayName = "ChangedFileRow";
