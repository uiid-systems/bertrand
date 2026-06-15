import { Stack, Text } from "@uiid/design-system";

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

const DIFF_PREVIEW_ROWS = 5;

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
            rows={DIFF_PREVIEW_ROWS}
            defaultExpanded={false}
          />
        ))}
      </Stack>
    );
  }
  return (
    <DiffBlock
      oldStr={permission.oldStr ?? ""}
      newStr={permission.newStr ?? ""}
      rows={DIFF_PREVIEW_ROWS}
      defaultExpanded={false}
    />
  );
}

function permissionTrigger(p: PermissionDetail): string {
  const prefix = p.count > 1 ? `${p.count}× ` : "";
  return p.detail ? `${prefix}${p.detail}` : `${prefix}${p.tool}`;
}

function PermissionLabel({ permission }: { permission: PermissionDetail }) {
  return (
    <Text size={-1} family="mono" shade="muted">
      {permissionTrigger(permission)}
    </Text>
  );
}

type WorkContentProps = {
  event: EventRow;
};

export function WorkContent({ event }: WorkContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  if (!meta?.permissions) return null;

  const permissions = meta.permissions as PermissionDetail[];
  if (permissions.length === 0) return null;

  if (permissions.length === 1) {
    const p = permissions[0];
    if (!p.detail) return null;

    if (hasDiff(p)) {
      return (
        <Stack data-slot="work-content" gap={1} fullwidth>
          <PermissionLabel permission={p} />
          <DiffContent permission={p} />
        </Stack>
      );
    }

    return <PermissionLabel permission={p} />;
  }

  return <MultiPermissionContent permissions={permissions} />;
}

function MultiPermissionContent({
  permissions,
}: {
  permissions: PermissionDetail[];
}) {
  // Split diff-bearing entries from info-only entries: each diff gets its
  // own CodeBlock with built-in collapse (rows={DIFF_PREVIEW_ROWS}); info-only
  // tools render as plain mono labels because they have nothing to expand to.
  const diffPermissions = permissions.filter(hasDiff);
  const infoPermissions = permissions.filter((p) => !hasDiff(p));

  return (
    <Stack data-slot="work-content" gap={2} fullwidth>
      {diffPermissions.length > 0 && (
        <Stack gap={2} fullwidth>
          {diffPermissions.map((p, i) => (
            <Stack key={`diff-${i}`} gap={1} fullwidth>
              <PermissionLabel permission={p} />
              <DiffContent permission={p} />
            </Stack>
          ))}
        </Stack>
      )}
      {infoPermissions.length > 0 && (
        <Stack gap={1} fullwidth>
          {infoPermissions.map((p, i) => (
            <PermissionLabel key={`info-${i}`} permission={p} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
WorkContent.displayName = "WorkContent";
