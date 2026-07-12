import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Status,
  type StatusProps,
  Text,
} from "@uiid/design-system";

import {
  ExternalLinkIcon,
  PlayIcon,
  ScrollTextIcon,
  SquareIcon,
  Trash2Icon,
} from "@uiid/icons";

import {
  startWorktree,
  stopWorktree,
  deleteWorktree,
  fetchWorktreeLogs,
  WorktreeDeleteError,
} from "../../api/queries";
import type {
  WorktreeSessionRow,
  WorkspaceServerStatus,
} from "../../api/types";
import { statusColor } from "../../lib/format";
import {
  editorFileUri,
  editorLabel,
  usePreferredEditor,
} from "../../lib/editor";

export type WorktreeItemProps = {
  entry: WorktreeSessionRow;
  preview?: WorkspaceServerStatus;
};

const truncate = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * A session's worktree: branch, preview state and controls. Rendered by the
 * per-session WorktreeZone, so it never needs to say which session it belongs
 * to — the surrounding page is that session.
 *
 * State words are observed, not assumed: "running" means something answers
 * on the reported port (the server checks via lsof); a live process that
 * hasn't bound yet — installing, compiling, or pointed at the wrong port —
 * shows as "starting" with the notes below explaining why.
 *
 * Deletion is a two-step confirm: the modal states what goes (the checkout)
 * and what stays (the branch); when the server reports uncommitted changes,
 * the modal escalates to an explicit "Force delete" instead of dead-ending.
 */
export const WorktreeItem = ({ entry, preview }: WorktreeItemProps) => {
  const { session, branch } = entry;
  const qc = useQueryClient();
  const [editor] = usePreferredEditor();
  const [showLogs, setShowLogs] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const running = preview?.running ?? false;
  const listening = preview?.listening ?? false;
  const portMismatch =
    listening &&
    preview?.observedPort != null &&
    preview?.port != null &&
    preview.observedPort !== preview.port;

  const refresh = () => qc.invalidateQueries({ queryKey: ["worktree-status"] });
  const start = useMutation({
    mutationFn: () => startWorktree(session.id),
    onSuccess: refresh,
  });
  const stop = useMutation({
    mutationFn: () => stopWorktree(session.id),
    onSuccess: refresh,
  });

  const del = useMutation({
    mutationFn: (force: boolean) => deleteWorktree(session.id, { force }),
    onSuccess: () => {
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["worktrees"] });
      qc.invalidateQueries({ queryKey: ["worktree-status"] });
    },
  });
  const dirty =
    del.error instanceof WorktreeDeleteError && del.error.reason === "dirty";

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
    <Stack data-slot="worktree-item" gap={1} py={2} px={2} bb={1} fullwidth>
      <Group ay="center" gap={2} fullwidth>
        <Status color={listening ? "green" : running ? "yellow" : color} />
        <Text
          family="mono"
          weight="bold"
          size={0}
          style={truncate}
          title={session.worktreePath ?? undefined}
        >
          {branch ?? "(unknown branch)"}
        </Text>
        {listening ? (
          <Badge color="green" ml="auto">
            running
          </Badge>
        ) : running ? (
          <Badge color="yellow" ml="auto">
            starting
          </Badge>
        ) : (
          <Badge color="neutral" ml="auto">
            idle
          </Badge>
        )}
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
          {session.worktreePath && (
            <Button
              size="xsmall"
              variant="ghost"
              shape="square"
              aria-label={`Open worktree in ${editorLabel(editor)}`}
              tooltip={`Open in ${editorLabel(editor)}`}
              render={<a href={editorFileUri(editor, session.worktreePath)} />}
            >
              <ExternalLinkIcon size={13} />
            </Button>
          )}
          {running ? (
            <Button
              size="xsmall"
              shape="square"
              aria-label="Stop preview"
              tooltip="Stop preview"
              onClick={() => stop.mutate()}
              loading={stop.isPending}
            >
              <SquareIcon size={13} />
            </Button>
          ) : (
            <Button
              size="xsmall"
              variant="ghost"
              shape="square"
              aria-label="Start preview"
              tooltip="Start preview"
              onClick={() => start.mutate()}
              loading={start.isPending}
            >
              <PlayIcon size={13} />
            </Button>
          )}
          <Button
            size="xsmall"
            variant="ghost"
            shape="square"
            aria-pressed={showLogs}
            aria-label={showLogs ? "Hide logs" : "Show logs"}
            tooltip={showLogs ? "Hide logs" : "Show logs"}
            onClick={() => setShowLogs((s) => !s)}
          >
            <ScrollTextIcon size={13} />
          </Button>
          {/* Deleting while running is safe server-side (teardown stops the
              preview before git removes anything) — the disable only guards
              against yanking a preview someone is actively using. */}
          <Button
            size="xsmall"
            variant="ghost"
            shape="square"
            disabled={running}
            aria-label="Delete worktree"
            tooltip={running ? "Stop the preview first" : "Delete worktree"}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon size={13} color="var(--color-red)" />
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
          {preview!.port} — the URL follows the real port. Commit a run override
          that passes $BERTRAND_PORT to pin it.
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

      <Modal
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) del.reset();
        }}
        title={dirty ? "Worktree has uncommitted changes" : "Delete worktree"}
        description={
          dirty
            ? "Force-deleting discards the uncommitted changes permanently."
            : "Removes the checkout from disk and stops its preview server. The branch is kept."
        }
        footer={
          <Group gap={2} ax="end" fullwidth>
            <Button variant="subtle" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="inverted"
              loading={del.isPending}
              onClick={() => del.mutate(dirty)}
            >
              {dirty ? "Force delete" : "Delete"}
            </Button>
          </Group>
        }
      >
        <Stack gap={2} fullwidth>
          <Text size={-1} family="mono" style={{ wordBreak: "break-all" }}>
            {session.worktreePath}
          </Text>
          {del.error && !dirty && (
            <Text size={-1} shade="muted">
              ⚠ {del.error.message}
              {del.error instanceof WorktreeDeleteError && del.error.detail
                ? ` — ${del.error.detail}`
                : ""}
            </Text>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
};
WorktreeItem.displayName = "WorktreeItem";
