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
import { Trash2Icon } from "@uiid/icons";

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
export function SessionExitPanel({
  session,
  categoryPath,
  exitCode,
  conversationCount,
  project,
}: {
  readonly session: SessionRow;
  readonly categoryPath: string;
  readonly exitCode: number | null;
  readonly conversationCount: number;
  readonly project?: string;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const archive = useArchiveAction(session, project);
  const { rate, discard } = useSessionExitActions(session, project, {
    // The route is keyed by the session that no longer exists, so staying here
    // would render a "not found" shell. Fall back to the category it lived in.
    onDiscarded: () => {
      setConfirmOpen(false);
      // Plain path string, matching how every other link in this app addresses
      // the splat route (see RouterLink in routes/$.tsx).
      void navigate({ to: `/${categoryPath}` });
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
            {categoryPath}/{session.slug}
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
