import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Group,
  Stack,
  Status,
  type StatusProps,
  Text,
} from "@uiid/design-system";
import {
  worktreesQuery,
  worktreeStatusQuery,
  startWorktree,
  stopWorktree,
  fetchWorktreeLogs,
} from "../api/queries";
import type { SessionWithCategory, WorkspaceServerStatus } from "../api/types";
import { formatRelativeTime, statusColor } from "../lib/format";

function WorktreeRow({
  entry,
  preview,
}: {
  entry: SessionWithCategory;
  preview?: WorkspaceServerStatus;
}) {
  const { session, categoryPath } = entry;
  const qc = useQueryClient();
  const [showLogs, setShowLogs] = useState(false);
  const running = preview?.running ?? false;
  // "listening" is observed by the server (lsof), not assumed from the PID —
  // a process that's installing/compiling, or that bound a different port,
  // must not render as a working preview.
  const listening = preview?.listening ?? false;
  const portMismatch =
    listening &&
    preview?.observedPort != null &&
    preview?.port != null &&
    preview.observedPort !== preview.port;

  const refresh = () => qc.invalidateQueries({ queryKey: ["worktree-status"] });
  const start = useMutation({ mutationFn: () => startWorktree(session.id), onSuccess: refresh });
  const stop = useMutation({ mutationFn: () => stopWorktree(session.id), onSuccess: refresh });

  // Only poll logs while the panel is open; keep refreshing them while the
  // server runs so a starting/installing worktree shows progress live.
  const logs = useQuery({
    queryKey: ["worktree-logs", session.id],
    queryFn: () => fetchWorktreeLogs(session.id),
    enabled: showLogs,
    refetchInterval: showLogs && running ? 2000 : false,
  });

  const color = statusColor(session.status) as StatusProps["color"];
  const error = (start.error ?? stop.error) as Error | null;

  return (
    <Stack gap={2} py={2} px={2} bb={1} fullwidth>
      <Group ay="center" gap={3} fullwidth>
        <Status color={listening ? "green" : running ? "yellow" : color} />
        <Stack gap={1}>
          <Text family="mono" weight="bold">
            {session.worktreeBranch ?? "(unknown branch)"}
          </Text>
          <Group gap={2} ay="center">
            <Text
              size={-1}
              shade="muted"
              render={
                <Link to="/$" params={{ _splat: `${categoryPath}/${session.slug}` }} />
              }
            >
              {categoryPath} / {session.slug}
            </Text>
            <Text size={-1} shade="muted">
              · {formatRelativeTime(session.updatedAt)}
            </Text>
          </Group>
        </Stack>

        <Group gap={2} ay="center" ml="auto">
          {listening && preview?.url && (
            <Text
              size={-1}
              family="mono"
              render={<a href={preview.url} target="_blank" rel="noreferrer" />}
            >
              {preview.url}
            </Text>
          )}
          {listening ? (
            <Badge color="green">running</Badge>
          ) : running ? (
            <Badge color="yellow">starting</Badge>
          ) : (
            <Badge color="neutral">idle</Badge>
          )}
          {running ? (
            <Button size="xsmall" variant="subtle" onClick={() => stop.mutate()} loading={stop.isPending}>
              Stop
            </Button>
          ) : (
            <Button size="xsmall" variant="subtle" onClick={() => start.mutate()} loading={start.isPending}>
              Start preview
            </Button>
          )}
          <Button size="xsmall" variant="ghost" onClick={() => setShowLogs((s) => !s)}>
            {showLogs ? "Hide logs" : "Logs"}
          </Button>
        </Group>
      </Group>

      {error && (
        <Text size={-1} shade="muted">
          ⚠ {error.message}
        </Text>
      )}

      {portMismatch && (
        <Text size={-1} shade="muted">
          ⚠ App bound :{preview!.observedPort} instead of the assigned :
          {preview!.port} — the URL follows the real port. Commit a run
          override that passes $BERTRAND_PORT to pin it.
        </Text>
      )}

      {running && !listening && (
        <Text size={-1} shade="muted">
          Process is up but nothing is listening yet (installing/compiling —
          check the logs if this persists).
        </Text>
      )}

      {showLogs && (
        <pre
          style={{
            maxHeight: 240,
            overflow: "auto",
            fontSize: 12,
            margin: 0,
            padding: 8,
            borderRadius: 4,
            whiteSpace: "pre-wrap",
            background: "var(--shade-accent, #1113)",
          }}
        >
          {logs.data || (logs.isLoading ? "Loading…" : "No output yet.")}
        </pre>
      )}

      {session.worktreePath && (
        <Text size={-1} shade="muted" family="mono">
          {session.worktreePath}
        </Text>
      )}
    </Stack>
  );
}

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
            <WorktreeRow
              key={entry.session.id}
              entry={entry}
              preview={statusById[entry.session.id]}
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
