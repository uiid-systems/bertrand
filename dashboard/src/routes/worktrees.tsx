import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Group,
  Stack,
  Status,
  type StatusProps,
  Text,
} from "@uiid/design-system";
import { worktreesQuery } from "../api/queries";
import { formatRelativeTime, statusColor } from "../lib/format";

function WorktreesPage() {
  const { data: worktrees = [] } = useQuery(worktreesQuery);

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
          Sessions currently working in an isolated git worktree.
        </Text>
      </Stack>

      {worktrees.length === 0 ? (
        <Text size={1} shade="muted">
          No active worktrees. A session lands here once it enters one for
          git-bound work.
        </Text>
      ) : (
        <Stack gap={1} fullwidth>
          {worktrees.map(({ session, categoryPath }) => {
            const color = statusColor(session.status) as StatusProps["color"];
            return (
              <Group key={session.id} ay="center" gap={3} py={2} px={2} bb={1} fullwidth>
                <Status color={color} />
                <Stack gap={1}>
                  <Text family="mono" weight="bold">
                    {session.worktreeBranch ?? "(unknown branch)"}
                  </Text>
                  <Group gap={2} ay="center">
                    <Text
                      size={-1}
                      shade="muted"
                      render={
                        <Link
                          to="/$"
                          params={{ _splat: `${categoryPath}/${session.slug}` }}
                        />
                      }
                    >
                      {categoryPath} / {session.slug}
                    </Text>
                    <Text size={-1} shade="muted">
                      · {formatRelativeTime(session.updatedAt)}
                    </Text>
                  </Group>
                  {session.worktreePath && (
                    <Text size={-1} shade="muted" family="mono">
                      {session.worktreePath}
                    </Text>
                  )}
                </Stack>
                <Badge color={color} ml="auto">
                  {session.status}
                </Badge>
              </Group>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

export const Route = createFileRoute("/worktrees")({
  component: WorktreesPage,
});
