import { Accordion, List, Stack, Text } from "@uiid/design-system";
import { CheckIcon } from "@uiid/icons";

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

function formatPermissionLine(p: PermissionDetail): string {
  const prefix = p.count > 1 ? `${p.count}× ` : "";
  return p.detail ? `${prefix}${p.tool}: ${p.detail}` : `${prefix}${p.tool}`;
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
              trigger: p.detail,
              content: <DiffContent permission={p} />,
            },
          ]}
        />
      );
    }

    return (
      <Text size={-1} family="mono" shade="muted">
        {p.detail}
      </Text>
    );
  }

  // Multiple permissions — accordion with details
  const totalCount = permissions.reduce((sum, p) => sum + p.count, 0);
  const items = permissions.map((p, i) => ({
    label: formatPermissionLine(p),
    value: `permission-${i}`,
  }));

  return (
    <Accordion
      items={[
        {
          icon: CheckIcon,
          value: "permissions",
          trigger: `${totalCount} approved tool${totalCount === 1 ? "" : "s"}`,
          content: <List type="ordered" size="small" items={items} />,
        },
      ]}
    />
  );
}
WorkContent.displayName = "WorkContent";
