import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
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
  startWorktree,
  stopWorktree,
  fetchWorktreeLogs,
} from "../../api/queries";
import type { WorktreeSessionRow, WorkspaceServerStatus } from "../../api/types";
import { formatRelativeTime, statusColor } from "../../lib/format";

export type WorktreeItemProps = {
  entry: WorktreeSessionRow;
  preview?: WorkspaceServerStatus;
  /** Show the full worktree path — useful on the page, too wide for a sidebar. */
  showPath?: boolean;
};

const truncate = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * One worktree-bearing session: branch, session link, preview state and
 * controls. Designed narrow-first so the same row works in the secondary
 * sidebar and on the worktrees page.
 *
 * State words are observed, not assumed: "running" means something answers
 * on the reported port (the server checks via lsof); a live process that
 * hasn't bound yet — installing, compiling, or pointed at the wrong port —
 * shows as "starting" with the notes below explaining why.
 */
export const WorktreeItem = ({ entry, preview, showPath }: WorktreeItemProps) => {
  const { session, categoryPath, branch } = entry;
  const qc = useQueryClient();
  const [showLogs, setShowLogs] = useState(false);
  const running = preview?.running ?? false;
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

  // "You are here": the row for the session currently open in the detail view
  // (same convention as the primary sidebar's session rows).
  const splat = `${categoryPath}/${session.slug}`;
  const { _splat } = useParams({ strict: false });
  const isCurrent = (_splat ?? "").replace(/^\/+|\/+$/g, "") === splat;

  const color = statusColor(session.status) as StatusProps["color"];
  const error = (start.error ?? stop.error) as Error | null;

  return (
    <Stack
      data-slot="worktree-item"
      gap={1}
      py={2}
      px={2}
      bb={1}
      fullwidth
      aria-current={isCurrent ? "true" : undefined}
    >
      <Group ay="center" gap={2} fullwidth>
        <Status color={listening ? "green" : running ? "yellow" : color} />
        <Text family="mono" weight="bold" size={0} style={truncate}>
          {branch ?? "(unknown branch)"}
        </Text>
        {listening ? (
          <Badge color="green" ml="auto">running</Badge>
        ) : running ? (
          <Badge color="yellow" ml="auto">starting</Badge>
        ) : (
          <Badge color="neutral" ml="auto">idle</Badge>
        )}
      </Group>

      <Group gap={2} ay="center" fullwidth>
        <Text
          size={-1}
          shade="muted"
          style={truncate}
          render={<Link to="/$" params={{ _splat: splat }} />}
        >
          {categoryPath} / {session.slug}
        </Text>
        <Text size={-1} shade="muted">
          · {formatRelativeTime(session.updatedAt)}
        </Text>
      </Group>

      <Group gap={2} ay="center" fullwidth>
        {listening && preview?.url && (
          <Text
            size={-1}
            family="mono"
            style={truncate}
            render={<a href={preview.url} target="_blank" rel="noreferrer" />}
          >
            {preview.url}
          </Text>
        )}
        <Group gap={1} ay="center" ml="auto">
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

      {showPath && session.worktreePath && (
        <Text size={-1} shade="muted" family="mono" style={truncate}>
          {session.worktreePath}
        </Text>
      )}
    </Stack>
  );
};
WorktreeItem.displayName = "WorktreeItem";
