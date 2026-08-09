import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  Group,
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
  worktreeFilesQuery,
  WorktreeDeleteError,
} from "../../api/queries";
import type {
  WorktreeSessionRow,
  WorkspaceServerStatus,
} from "../../api/types";
import { statusColor } from "../../lib/format";
import { ChangedFileRow } from "./changed-file-row";
import {
  editorFileUri,
  editorLabel,
  usePreferredEditor,
} from "../../lib/editor";

export type WorktreeItemProps = {
  /** The session this row acts on. Passed separately from `entry` because a
   * session without a worktree has no /api/worktrees row to read it from. */
  sessionId: string;
  /** The session's worktree, when it has one. Absent means it never entered
   * one — the row still renders, says so, and disables its controls. */
  entry?: WorktreeSessionRow;
  preview?: WorkspaceServerStatus;
  /** The worktree list hasn't resolved yet. Renders the row neutral instead
   * of briefly claiming the session has no worktree. */
  pending?: boolean;
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
 *
 * A session with no worktree renders the same row rather than disappearing:
 * "No worktree" with every control disabled and a tooltip saying why. The
 * absence is a fact about the session worth stating in place.
 */
export const WorktreeItem = ({
  sessionId,
  entry,
  preview,
  pending,
}: WorktreeItemProps) => {
  const session = entry?.session;
  const branch = entry?.branch;
  const worktreePath = session?.worktreePath ?? null;
  // Nothing on disk to act on: every control below is inert. While the list is
  // still loading we disable the same way but stay quiet about the reason.
  const missing = !entry;
  const disabled = missing || !!pending;
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

  const refresh = () => qc.invalidateQueries({ queryKey: ["worktrees"] });
  const start = useMutation({
    mutationFn: () => startWorktree(sessionId),
    onSuccess: refresh,
  });
  const stop = useMutation({
    mutationFn: () => stopWorktree(sessionId),
    onSuccess: refresh,
  });

  const del = useMutation({
    mutationFn: (force: boolean) => deleteWorktree(sessionId, { force }),
    onSuccess: () => {
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["worktrees"] });
    },
  });
  const dirty =
    del.error instanceof WorktreeDeleteError && del.error.reason === "dirty";

  // Only fetched once the server has refused a delete for being dirty — the
  // modal then shows exactly what "Force delete" would discard.
  const discarded = useQuery({
    ...worktreeFilesQuery(sessionId, "uncommitted"),
    enabled: dirty && confirmOpen,
    refetchInterval: false,
  });

  // Only poll logs while the panel is open; keep refreshing them while the
  // server runs so a starting/installing worktree shows progress live.
  const logs = useQuery({
    queryKey: ["worktree-logs", sessionId],
    queryFn: () => fetchWorktreeLogs(sessionId),
    enabled: showLogs,
    refetchInterval: showLogs && running ? 2000 : false,
  });

  const color = (
    session ? statusColor(session.status) : "neutral"
  ) as StatusProps["color"];
  const error = (start.error ?? stop.error) as Error | null;

  return (
    <Stack data-slot="worktree-item" gap={4} p={2} pb={0} fullwidth>
      <Group ay="center" gap={2} fullwidth>
        <Status color={listening ? "green" : running ? "yellow" : color} />
        {entry ? (
          <Text
            weight="bold"
            size={-1}
            style={truncate}
            title={worktreePath ?? undefined}
          >
            {branch ?? "(unknown branch)"}
          </Text>
        ) : (
          <Text weight="bold" shade="halftone" style={truncate}>
            {pending ? "Checking…" : "No worktree"}
          </Text>
        )}
        {pending ? null : missing ? (
          <></>
        ) : listening ? (
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
          {/* Stays a real <button> without a path — an anchor ignores
              `disabled` and would navigate to a dead file URI. */}
          <Button
            size="xsmall"
            variant="subtle"
            disabled={!worktreePath}
            aria-label={`Open worktree in ${editorLabel(editor)}`}
            tooltip={
              worktreePath
                ? `Open in ${editorLabel(editor)}`
                : "No worktree to open"
            }
            render={
              worktreePath ? (
                <a href={editorFileUri(editor, worktreePath)} />
              ) : undefined
            }
          >
            <ExternalLinkIcon size={13} />
          </Button>
          {running ? (
            <Button
              size="xsmall"
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
              variant="subtle"
              disabled={disabled}
              aria-label="Start preview"
              tooltip={missing ? "No worktree to preview" : "Start preview"}
              onClick={() => start.mutate()}
              loading={start.isPending}
            >
              <PlayIcon size={13} />
            </Button>
          )}
          <Button
            size="xsmall"
            variant="subtle"
            disabled={disabled}
            aria-pressed={showLogs}
            aria-label={showLogs ? "Hide logs" : "Show logs"}
            tooltip={
              missing
                ? "No preview logs without a worktree"
                : showLogs
                  ? "Hide logs"
                  : "Show logs"
            }
            onClick={() => setShowLogs((s) => !s)}
          >
            <ScrollTextIcon size={13} />
          </Button>
          {/* Deleting while running is safe server-side (teardown stops the
              preview before git removes anything) — the disable only guards
              against yanking a preview someone is actively using. */}
          <Button
            size="xsmall"
            variant="subtle"
            color="red"
            disabled={running || disabled}
            aria-label="Delete worktree"
            tooltip={
              missing
                ? "No worktree to delete"
                : running
                  ? "Stop the preview first"
                  : "Delete worktree"
            }
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon />
          </Button>
        </Group>
      </Group>

      {/* {missing && !pending && (
        <Text size={-1} shade="muted">
          This session isn't working in a worktree — there's no checkout to
          open, preview or delete.
        </Text>
      )} */}

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

      {listening && preview?.api && !preview.api.listening && (
        <Text size={-1} shade="muted">
          ⚠ API sidecar isn't up on :{preview.api.port} yet — the UI is served
          but /api requests will fail until it binds. Check the logs if this
          persists.
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

      <Dialog
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
              color="red"
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
            {worktreePath}
          </Text>
          {dirty &&
            (discarded.data ? (
              discarded.data.files.length > 0 && (
                <Group
                  gap={1}
                  fullwidth
                  maxh={180}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    overflowY: "auto",
                  }}
                >
                  {discarded.data.files.map((file) => (
                    <ChangedFileRow key={file.path} file={file} />
                  ))}
                </Group>
              )
            ) : (
              <Text size={-1} shade="muted">
                Listing uncommitted changes…
              </Text>
            ))}
          {del.error && !dirty && (
            <Text size={-1} shade="muted">
              ⚠ {del.error.message}
              {del.error instanceof WorktreeDeleteError && del.error.detail
                ? ` — ${del.error.detail}`
                : ""}
            </Text>
          )}
        </Stack>
      </Dialog>
    </Stack>
  );
};
WorktreeItem.displayName = "WorktreeItem";
