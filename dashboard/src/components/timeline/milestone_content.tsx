import { Text } from "@uiid/design-system";

import type { EventRow } from "../../api/types";

type MilestoneContentProps = {
  event: EventRow;
};

export function MilestoneContent({ event }: MilestoneContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  if (!meta) return null;

  switch (event.event) {
    case "gh.pr.created": {
      const title = meta.pr_title as string | undefined;
      const url = meta.pr_url as string | undefined;
      return (
        <>
          {title && <Text size={1}>{title}</Text>}
          {url && (
            <Text size={-1} family="mono" color="neutral">
              {url}
            </Text>
          )}
        </>
      );
    }
    case "gh.pr.merged": {
      const branch = meta.branch as string | undefined;
      return branch ? (
        <Text size={1} family="mono">
          {branch}
        </Text>
      ) : null;
    }
    case "vercel.deploy": {
      const project = meta.project_name as string | undefined;
      return project ? <Text size={1}>{project}</Text> : null;
    }
    default:
      return null;
  }
}
MilestoneContent.displayName = "MilestoneContent";
