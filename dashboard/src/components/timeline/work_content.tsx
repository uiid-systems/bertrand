import { Accordion, Stack, Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";

type EditEntry = { oldStr: string; newStr: string };

type PermissionDetail = {
  tool: string;
  detail: string;
  outcome: string;
  count: number;
  oldStr?: string;
  newStr?: string;
  edits?: EditEntry[];
};

function hasDiff(p: PermissionDetail): boolean {
  return Boolean(p.oldStr || p.newStr || (p.edits && p.edits.length > 0));
}

function DiffLines({ oldStr, newStr }: { oldStr?: string; newStr?: string }) {
  const oldLines = oldStr ? oldStr.split("\n") : [];
  const newLines = newStr ? newStr.split("\n") : [];

  return (
    <Stack gap={0}>
      {oldLines.map((line, i) => (
        <Text key={`old-${i}`} size={-1} family="mono" color="red">
          {`- ${line}`}
        </Text>
      ))}
      {newLines.map((line, i) => (
        <Text key={`new-${i}`} size={-1} family="mono" color="green">
          {`+ ${line}`}
        </Text>
      ))}
    </Stack>
  );
}

function DiffContent({ permission }: { permission: PermissionDetail }) {
  if (permission.edits && permission.edits.length > 0) {
    return (
      <Stack gap={2}>
        {permission.edits.map((edit, i) => (
          <DiffLines key={i} oldStr={edit.oldStr} newStr={edit.newStr} />
        ))}
      </Stack>
    );
  }
  return <DiffLines oldStr={permission.oldStr} newStr={permission.newStr} />;
}

function permissionTrigger(p: PermissionDetail): string {
  const prefix = p.count > 1 ? `${p.count}× ` : "";
  return p.detail ? `${prefix}${p.detail}` : `${prefix}${p.tool}`;
}

type WorkContentProps = {
  event: EventRow;
};

export function WorkContent({ event }: WorkContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  if (!meta?.permissions) return null;

  const permissions = meta.permissions as PermissionDetail[];
  if (permissions.length === 0) return null;

  // Single permission — show detail inline; expand into diff if present
  if (permissions.length === 1) {
    const p = permissions[0];
    if (!p.detail) return null;

    if (hasDiff(p)) {
      return (
        <Accordion
          items={[
            {
              value: "diff",
              trigger: permissionTrigger(p),
              content: <DiffContent permission={p} />,
            },
          ]}
        />
      );
    }

    return (
      <Text size={-1} family="mono" shade="muted">
        {permissionTrigger(p)}
      </Text>
    );
  }

  // Multiple permissions — one accordion item per file, each expanding to its diff
  return (
    <Stack gap={2}>
      <Text size={-1} shade="muted">
        {`${permissions.length} files`}
      </Text>
      <Accordion
        multiple
        items={permissions.map((p, i) => ({
          value: `permission-${i}`,
          trigger: permissionTrigger(p),
          content: hasDiff(p) ? (
            <DiffContent permission={p} />
          ) : (
            <Text size={-1} shade="muted">
              No diff captured
            </Text>
          ),
        }))}
      />
    </Stack>
  );
}
WorkContent.displayName = "WorkContent";
