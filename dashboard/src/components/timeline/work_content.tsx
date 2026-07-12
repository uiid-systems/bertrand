import { useState } from "react";
import { Collapsible, Group, Stack, Text } from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

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
  // Normalize MultiEdit (`edits[]`) and single-edit (`oldStr`/`newStr`)
  // into one list of hunks so they all land inside the same CodeBlock —
  // multiple edits to one file shouldn't render as N stacked blocks.
  const edits =
    permission.edits && permission.edits.length > 0
      ? permission.edits.map((e) => ({
          oldStr: e.oldStr ?? "",
          newStr: e.newStr ?? "",
        }))
      : [{ oldStr: permission.oldStr ?? "", newStr: permission.newStr ?? "" }];

  return (
    <DiffBlock
      edits={edits}
      filename={permission.detail}
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

    // Diff entries: CodeBlock's filename header already shows the file
    // path, so a separate label row above it would just repeat it.
    if (hasDiff(p)) return <DiffContent permission={p} />;

    return <PermissionLabel permission={p} />;
  }

  return <MultiPermissionContent permissions={permissions} />;
}

function MultiPermissionContent({
  permissions,
}: {
  permissions: PermissionDetail[];
}) {
  // Split diff-bearing entries from info-only entries: each diff renders
  // as one CodeBlock with built-in collapse (rows={DIFF_PREVIEW_ROWS});
  // info-only tools (Bash, etc.) render as plain mono labels because they
  // have no diff to host the detail.
  const diffPermissions = permissions.filter(hasDiff);
  const infoPermissions = permissions.filter((p) => !hasDiff(p));

  return (
    <Stack data-slot="work-content" gap={2} fullwidth>
      {diffPermissions.length > 0 && (
        <Stack gap={2} fullwidth>
          {diffPermissions.map((p, i) => (
            <DiffContent key={`diff-${i}`} permission={p} />
          ))}
        </Stack>
      )}
      {infoPermissions.length > 0 && (
        <InfoPermissions permissions={infoPermissions} />
      )}
    </Stack>
  );
}

/**
 * The non-diff tool calls (Bash, Read, Grep, …) are the noisy part of a busy
 * work stretch — consecutive ones are already merged upstream, so they arrive
 * as a long list. Collapse them behind a one-line summary (closed by default)
 * while diffs stay visible inline, so command noise doesn't crowd out the
 * prompts/answers/messages that carry the session's narrative.
 */
function InfoPermissions({ permissions }: { permissions: PermissionDetail[] }) {
  const [open, setOpen] = useState(false);
  const count = permissions.length;
  const summary = `${count} tool ${count === 1 ? "call" : "calls"}`;

  return (
    <Collapsible
      RootProps={{ open, onOpenChange: setOpen }}
      TriggerProps={{ nativeButton: false }}
      trigger={
        <Group gap={1} ay="center" style={{ cursor: "pointer" }}>
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
          <Text size={-1} family="mono" shade="muted">
            {summary}
          </Text>
        </Group>
      }
    >
      <Stack gap={1} pt={2} fullwidth>
        {permissions.map((p, i) => (
          <PermissionLabel key={`info-${i}`} permission={p} />
        ))}
      </Stack>
    </Collapsible>
  );
}
WorkContent.displayName = "WorkContent";
