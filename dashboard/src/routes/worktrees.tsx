import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Badge, Group, Stack, Text } from "@uiid/design-system";

import { worktreesQuery } from "../api/queries";
import { WorktreeItem } from "../components/worktrees";
import { formatRelativeTime } from "../lib/format";

/**
 * All worktree-bearing sessions across the in-scope projects, in one place.
 * A thin wrapper over the same shared components the per-session WorktreeZone
 * uses — each row is a WorktreeItem headed by a link back to its session, so
 * this page adds overview and navigation, not a second worktree UI.
 */
function WorktreesPage() {
  const { data: worktrees = [] } = useQuery(worktreesQuery);

  return (
    <Stack gap={6} p={6} ax="stretch" fullwidth style={{ overflowY: "auto" }}>
      <Stack gap={2}>
        <Group gap={2} ay="center">
          <Text size={3} weight="bold">
            Worktrees
          </Text>
          {worktrees.length > 0 && (
            <Badge color="blue">{worktrees.length}</Badge>
          )}
        </Group>
        <Text size={1} shade="muted">
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
        <Stack gap={4} ax="stretch" fullwidth style={{ maxWidth: 720 }}>
          {worktrees.map((entry) => (
            <Stack key={entry.session.id} gap={2} pb={4} bb={1} fullwidth>
              <Group gap={2} ay="center">
                <Text
                  size={-1}
                  shade="muted"
                  render={
                    <Link
                      to="/$"
                      params={{
                        _splat: `${entry.categoryPath}/${entry.session.slug}`,
                      }}
                    />
                  }
                >
                  {entry.categoryPath} / {entry.session.slug}
                </Text>
                <Text size={-1} shade="muted">
                  · {formatRelativeTime(entry.session.updatedAt)}
                </Text>
              </Group>
              <WorktreeItem entry={entry} preview={entry.status} />
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export const Route = createFileRoute("/worktrees")({
  component: WorktreesPage,
});
