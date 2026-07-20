import { Badge, Group, Text } from "@uiid/design-system";
import { FolderIcon, GitBranchIcon } from "@uiid/icons";

import type { EventRow } from "../../api/types";
import type { SegmentVitals } from "../../lib/timeline/segments";

type SessionStartedContentProps = Readonly<{
  event: EventRow;
  vitals: SegmentVitals;
}>;

function shortId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.slice(0, 8);
}

/**
 * The session-started card. Replaces the old bare claude_id badge with the
 * conversation's environment vitals — model and cwd/branch — all derived from
 * the segment's own events (see `deriveVitals`), so the readout is consistent
 * by construction and never depends on out-of-band capture. The short id is
 * kept as a muted trailing label for identification.
 */
export function SessionStartedContent({
  event,
  vitals,
}: SessionStartedContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  const id = shortId(
    (meta?.claude_id as string | undefined) ?? event.conversationId ?? undefined,
  );

  const { model, cwd, branch } = vitals;

  // Prefer branch (more specific — it names the work) over cwd, but fall back
  // to cwd so a non-worktree session still shows where it ran.
  const place = branch ?? cwd;
  const PlaceIcon = branch ? GitBranchIcon : FolderIcon;

  return (
    <Group data-slot="session-started-content" gap={2} ay="center">
      {model && (
        <Badge color="indigo" size="small">
          {model}
        </Badge>
      )}
      {place && (
        <Badge color="neutral" size="small">
          <Group gap={1} ay="center">
            <PlaceIcon size={12} />
            <span style={{ whiteSpace: "nowrap" }}>{place}</span>
          </Group>
        </Badge>
      )}
      {id && (
        <Text size={-1} family="mono" shade="muted">
          {id}
        </Text>
      )}
    </Group>
  );
}
SessionStartedContent.displayName = "SessionStartedContent";
