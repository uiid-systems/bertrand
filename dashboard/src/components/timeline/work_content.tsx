import { useState } from "react";
import {
  Accordion,
  Group,
  Stack,
  Text,
  ToggleButton,
} from "@uiid/design-system";
import { ChevronsDownUp, ChevronsUpDown } from "@uiid/icons";

import type { EventRow } from "../../api/types";
import { DiffBlock } from "../diff/diff-block";

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

function DiffContent({ permission }: { permission: PermissionDetail }) {
  if (permission.edits && permission.edits.length > 0) {
    return (
      <Stack gap={2} fullwidth>
        {permission.edits.map((edit, i) => (
          <DiffBlock
            key={i}
            oldStr={edit.oldStr ?? ""}
            newStr={edit.newStr ?? ""}
          />
        ))}
      </Stack>
    );
  }
  return (
    <DiffBlock
      oldStr={permission.oldStr ?? ""}
      newStr={permission.newStr ?? ""}
    />
  );
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
          ContentProps={{ fullwidth: true, p: 0 }}
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

  return <MultiPermissionContent permissions={permissions} />;
}

function MultiPermissionContent({
  permissions,
}: {
  permissions: PermissionDetail[];
}) {
  // Multiple permissions — split diff-bearing entries (accordion, expandable to
  // their diffs) from info-only entries (plain text rows). Mixing them in one
  // accordion misleads: non-edit tools have no diff to surface.
  const diffPermissions = permissions.filter(hasDiff);
  const infoPermissions = permissions.filter((p) => !hasDiff(p));
  const allValues = diffPermissions.map((_, i) => `permission-${i}`);
  const [openValues, setOpenValues] = useState<string[]>([]);
  const allOpen =
    allValues.length > 0 && openValues.length === allValues.length;

  return (
    <Stack data-slot="work-content" gap={2} fullwidth>
      {diffPermissions.length > 0 && (
        <Stack gap={1} fullwidth>
          <Group ax="end" fullwidth>
            <ToggleButton
              size="small"
              variant="subtle"
              tooltip={allOpen ? "Collapse all" : "Expand all"}
              pressed={!allOpen}
              onPressedChange={() => setOpenValues(allOpen ? [] : allValues)}
              icon={{
                unpressed: <ChevronsDownUp />,
                pressed: <ChevronsUpDown />,
              }}
              text={{ unpressed: "Collapse all", pressed: "Expand all" }}
            />
          </Group>
          <Accordion
            multiple
            value={openValues}
            onValueChange={(v) => setOpenValues(v as string[])}
            ContentProps={{ fullwidth: true, p: 0 }}
            items={diffPermissions.map((p, i) => ({
              value: `permission-${i}`,
              trigger: permissionTrigger(p),
              content: <DiffContent permission={p} />,
            }))}
          />
        </Stack>
      )}
      {infoPermissions.length > 0 && (
        <Stack gap={1} fullwidth>
          {infoPermissions.map((p, i) => (
            <Text key={`info-${i}`} size={-1} family="mono" shade="muted">
              {permissionTrigger(p)}
            </Text>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
WorkContent.displayName = "WorkContent";
