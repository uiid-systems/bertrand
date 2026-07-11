import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Group, Stack, Text } from "@uiid/design-system";

import { worktreesQuery, worktreeStatusQuery } from "../api/queries";
import { WorktreeItem } from "../components/worktrees";

/**
 * Thin wrapper over the shared worktree components — the list itself lives in
 * `components/worktrees` so the secondary sidebar mounts the same rows. This
 * page is slated for removal once the sidebar placement settles.
 */
function WorktreesPage() {
  const { data: worktrees = [] } = useQuery(worktreesQuery);
  const { data: statusById = {} } = useQuery(worktreeStatusQuery);

  return (
    <Stack gap={4} p={6} fullwidth style={{ overflow: "auto" }}>
      <Stack gap={2}>
        <Group gap={2} ay="center">
          <Text size={3} weight="bold">
            Worktrees
          </Text>
          {worktrees.length > 0 && <Badge color="blue">{worktrees.length}</Badge>}
        </Group>
        <Text size={2} shade="muted">
          Sessions working in an isolated git worktree. Start a preview to run
          its dev server and open the live URL — no cd required.
        </Text>
      </Stack>

      {worktrees.length === 0 ? (
        <Text size={1} shade="muted">
          No active worktrees. A session lands here once it enters one for
          git-bound work.
        </Text>
      ) : (
        <Stack gap={1} fullwidth>
          {worktrees.map((entry) => (
            <WorktreeItem
              key={entry.session.id}
              entry={entry}
              preview={statusById[entry.session.id]}
              showPath
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export const Route = createFileRoute("/worktrees")({
  component: WorktreesPage,
});
