import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Dialog,
  Group,
  Stack,
  Text,
} from "@uiid/design-system";
import { PlayIcon, PlusIcon, Trash2Icon } from "@uiid/icons";

import { useArchiveAction } from "../../api/use-archive-action";
import { useSessionExitActions } from "../../api/use-session-exit-actions";
import type { SessionRow } from "../../api/types";
import { formatDuration } from "../../lib/format";
import { StarRating } from "./star-rating";

/**
 * How an exit code reads to a person. 0 is the only unambiguously good one;
 * 130 and 143 are the shell's encoding of SIGINT and SIGTERM (128 + signal),
 * which is what a deliberate Ctrl+C or a `stop` looks like from here and is not
 * a failure. Anything else is reported as-is rather than guessed at.
 */
function describeExit(code: number | null): {
  label: string;
  color: "green" | "neutral" | "red";
} {
  if (code === null) return { label: "ended", color: "neutral" };
  if (code === 0) return { label: "exited cleanly", color: "green" };
  if (code === 130 || code === 143) return { label: "stopped", color: "neutral" };
  return { label: `exit code ${code}`, color: "red" };
}

/**
 * What the terminal zone shows once a session has ended — the dashboard's
 * counterpart to the TUI's post-exit screen (`src/tui/screens/Exit.tsx`), which
 * a browser-only session otherwise never gets (#214).
 *
 * Reads entirely from the session row and the event log, never from a live
 * relay frame. A browser that attaches *after* the session ended never received
 * the `ended` control frame (#215) and must still see this, so the durable
 * record is the only source that works in both cases.
 *
 * There is no "Save" button. Save is a no-op in the TUI — `finalize` has
 * already paused the session by the time the screen renders — and the TUI needs
 * it only because its screen is a modal gate that something has to dismiss.
 * This panel is not a gate, so the equivalent is stating that the work is
 * already saved.
 */
/** One resumable conversation, as the panel needs it. */
export type ResumableConversation = {
  conversationId: string;
  ordinal: number;
  title: string | null;
};

export function SessionExitPanel({
  session,
  exitCode,
  conversationCount,
  conversations,
  project,
}: {
  readonly session: SessionRow;
  readonly exitCode: number | null;
  readonly conversationCount: number;
  /** Newest first. Empty is fine — resume then only offers a new conversation. */
  readonly conversations: readonly ResumableConversation[];
  readonly project?: string;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const archive = useArchiveAction(session, project);
  const { rate, discard, resume, describeError } = useSessionExitActions(session, project, {
    // The route is keyed by the session that no longer exists, so staying here
    // would render a "not found" shell. Fall back home.
    onDiscarded: () => {
      setConfirmOpen(false);
      void navigate({ to: "/" });
    },
  });

  const exit = describeExit(exitCode);
  const durationSeconds =
    session.endedAt && session.startedAt
      ? (new Date(session.endedAt).getTime() -
          new Date(session.startedAt).getTime()) /
        1000
      : null;

  return (
    <Stack ax="stretch" fullwidth p={4} gap={4} style={{ overflowY: "auto" }}>
      <Stack gap={2}>
        <Group gap={2} ay="center">
          <Text weight="semibold">Session ended</Text>
          <Badge color={exit.color}>{exit.label}</Badge>
        </Group>
        <Group gap={3} ay="center">
          {durationSeconds !== null && (
            <Text size={-1} shade="muted">
              ran for {formatDuration(durationSeconds)}
            </Text>
          )}
          <Text size={-1} shade="muted">
            {conversationCount} conversation{conversationCount === 1 ? "" : "s"}
          </Text>
        </Group>
      </Stack>

      <Stack gap={2}>
        <Text size={-1} shade="muted">
          How effective was this session?
        </Text>
        <StarRating
          value={session.rating}
          onChange={(next) => rate.mutate(next)}
          disabled={rate.isPending}
        />
      </Stack>

      <Stack gap={2}>
        <Text size={-1} shade="muted">
          Pick up where this left off
        </Text>
        <Stack gap={1} ax="stretch">
          <Button
            size="small"
            variant="subtle"
            loading={resume.isPending && resume.variables === undefined}
            disabled={resume.isPending}
            onClick={() => resume.mutate(undefined)}
          >
            <PlusIcon size={13} />
            New conversation
          </Button>
          {conversations.map((c) => (
            <Button
              key={c.conversationId}
              size="small"
              variant="subtle"
              loading={
                resume.isPending && resume.variables === c.conversationId
              }
              disabled={resume.isPending}
              onClick={() => resume.mutate(c.conversationId)}
            >
              <PlayIcon size={13} />
              <Text truncate>
                Conversation {c.ordinal}
                {c.title ? ` — ${c.title}` : ""}
              </Text>
            </Button>
          ))}
        </Stack>
        {resume.error && (
          // Inline rather than a toast: at capacity the remedy is "stop another
          // session", and that belongs next to the button that just refused.
          <Text size={-1} shade="muted">
            ⚠ {describeError(resume.error)}
          </Text>
        )}
      </Stack>

      <Stack gap={2}>
        <Group gap={2} ay="center">
          <Button
            size="small"
            variant="subtle"
            disabled={archive.disabled}
            loading={archive.loading}
            onClick={archive.onClick}
            tooltip={archive.tooltip}
          >
            <archive.Icon size={13} />
            {archive.label}
          </Button>
          <Button
            size="small"
            variant="subtle"
            color="red"
            onClick={() => setConfirmOpen(true)}
            tooltip="Delete this session permanently"
          >
            <Trash2Icon size={13} />
            Discard
          </Button>
        </Group>
        <Text size={-1} shade="muted">
          Saved and paused — it will be here when you come back.
        </Text>
      </Stack>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) discard.reset();
        }}
        title="Discard session"
        description="This permanently deletes the session and everything recorded under it — every conversation, event, and statistic. It cannot be undone."
        footer={
          <Group gap={2} ax="end" fullwidth>
            <Button variant="subtle" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={discard.isPending}
              onClick={() => discard.mutate()}
            >
              Discard permanently
            </Button>
          </Group>
        }
      >
        <Stack gap={2} fullwidth>
          <Text size={-1} family="mono" style={{ wordBreak: "break-all" }}>
            {session.slug}
          </Text>
          <Text size={-1} shade="muted">
            {conversationCount} conversation
            {conversationCount === 1 ? "" : "s"} will be deleted. Archive instead
            if you only want it out of the way.
          </Text>
        </Stack>
      </Dialog>
    </Stack>
  );
}
SessionExitPanel.displayName = "SessionExitPanel";
