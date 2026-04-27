import { Accordion, Stack, Text } from "@uiid/design-system";
import { CheckIcon } from "@uiid/icons";

import type { EventRow } from "../../api/types";

type PermissionDetail = {
  tool: string;
  detail: string;
  outcome: string;
  count: number;
};

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

  // Single permission — show the detail inline
  if (permissions.length === 1) {
    const p = permissions[0];
    if (!p.detail) return null;

    return (
      <Text size={-1} family="mono" shade="muted">
        {p.detail}
      </Text>
    );
  }

  // Multiple permissions — accordion with details
  const totalCount = permissions.reduce((sum, p) => sum + p.count, 0);

  return (
    <Accordion
      items={[
        {
          icon: CheckIcon,
          value: "permissions",
          trigger: `${totalCount} approved tool${totalCount === 1 ? "" : "s"}`,
          content: (
            <Stack gap={1}>
              {permissions.map((p, i) => (
                <Text size={-1} family="mono" key={i}>
                  {formatPermissionLine(p)}
                </Text>
              ))}
            </Stack>
          ),
        },
      ]}
    />
  );
}
WorkContent.displayName = "WorkContent";
